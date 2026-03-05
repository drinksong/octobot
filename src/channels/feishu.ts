import * as lark from '@larksuiteoapi/node-sdk';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MessageBus, createInboundMessage, OutboundMessage } from '../bus';

export interface FeishuEvent {
  header: {
    event_id: string;
    event_type: string;
    event_time: number;
    token: string;
  };
  event: {
    sender: {
      sender_id: {
        open_id: string;
        union_id: string;
        user_id: string;
      };
      sender_type: string;
      chat_type: string;
    };
    message: {
      message_id: string;
      chat_id: string;
      content: string;
      msg_type?: string;
      message_type?: string;
      create_time: string;
      update_time: string;
      chat_type?: string;
    };
  };
}

export interface FeishuMessageResponse {
  code: number;
  msg: string;
  data?: {
    message_id: string;
  };
}

export class FeishuChannel {
  private client: lark.Client;
  private wsClient: lark.WSClient | null = null;
  private running = false;
  private processedMessageIds: Set<string> = new Set();

  constructor(
    private bus: MessageBus,
    private appId: string,
    private appSecret: string,
    private allowFrom: string[] = []
  ) {
    this.client = new lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    console.log('🚀 Starting Feishu channel...');

    this._startOutboundConsumer();

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: lark.LoggerLevel.info,
    });

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        this._handleEvent(data);
        return {};
      },
    });

    this.wsClient.start({
      eventDispatcher,
    });

    console.log('✅ Feishu WebSocket client started');
  }

  stop(): void {
    this.running = false;
    if (this.wsClient) {
      this.wsClient = null;
      console.log('🛑 Feishu WebSocket client stopped');
    }
  }

  private async _startOutboundConsumer(): Promise<void> {
    while (this.running) {
      try {
        const msg = await this.bus.consumeOutbound();
        if (msg && msg.channel === 'feishu') {
          if (msg.metadata?.kind === 'tool_call') {
            console.log(`🛠️ Tool call for ${msg.chatId}: ${msg.content}`);
            continue;
          }
          await this._sendMessage(msg.chatId, msg.content);
        }
      } catch (error) {
        console.error('Error consuming outbound message:', error);
      }
    }
  }

  private isAllowed(senderId: string): boolean {
    if (this.allowFrom.length === 0) {
      return true;
    }
    return this.allowFrom.includes(senderId);
  }

  private async _handleEvent(event: any): Promise<void> {
    try {
      if (event.event_type !== 'im.message.receive_v1') {
        return;
      }

      const { sender, message } = event;
      const messageType = message.message_type || message.msg_type;
      if (!messageType) {
        return;
      }

      const messageId = message.message_id;
      if (this.processedMessageIds.has(messageId)) {
        return;
      }
      this.processedMessageIds.add(messageId);
      if (this.processedMessageIds.size > 1000) {
        const arr = Array.from(this.processedMessageIds).slice(0, 500);
        this.processedMessageIds = new Set(arr);
      }

      if (sender.sender_type === 'bot') {
        return;
      }

      const userId = sender.sender_id.open_id;
      const chatId = message.chat_id;
      const chatType = message.chat_type || sender.chat_type;
      const { content, media } = await this._buildInboundContent(messageType, message.content, messageId);

      if (!this.isAllowed(userId)) {
        console.warn(`Access denied for sender ${userId} on channel feishu`);
        return;
      }

      if (!content && media.length === 0) {
        return;
      }

      console.log(`👤 User ${userId} in chat ${chatId}: ${content || '[media]'}`);

      await this._addReaction(messageId, 'THUMBSUP');

      await this.bus.publishInbound(createInboundMessage(
        'feishu',
        userId,
        chatId,
        content,
        {
          media,
          metadata: {
            message_id: messageId,
            chat_type: chatType,
            msg_type: messageType,
          }
        }
      ));
    } catch (error) {
      console.error('Error in _handleEvent:', error);
    }
  }

  private _parseMessageContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      if (parsed.text) {
        return parsed.text;
      }
      return content;
    } catch {
      return content;
    }
  }

  private async _buildInboundContent(
    messageType: string,
    rawContent: string,
    messageId: string
  ): Promise<{ content: string; media: string[] }> {
    const contentParts: string[] = [];
    const mediaPaths: string[] = [];
    const contentJson = this._parseContentJson(rawContent);

    if (messageType === 'text') {
      const text = contentJson.text || '';
      if (text) {
        contentParts.push(text);
      }
    } else if (messageType === 'post') {
      const { text, imageKeys } = this._extractPostContent(contentJson);
      if (text) {
        contentParts.push(text);
      }
      for (const imageKey of imageKeys) {
        const { filePath, note } = await this._downloadAndSaveMedia('image', { image_key: imageKey }, messageId);
        if (filePath) {
          mediaPaths.push(filePath);
        }
        if (note) {
          contentParts.push(note);
        }
      }
    } else if (['image', 'audio', 'file', 'media'].includes(messageType)) {
      const { filePath, note } = await this._downloadAndSaveMedia(messageType, contentJson, messageId);
      if (filePath) {
        mediaPaths.push(filePath);
      }
      if (note) {
        contentParts.push(note);
      }
    } else {
      contentParts.push(`[${messageType}]`);
    }

    return {
      content: contentParts.join('\n').trim(),
      media: mediaPaths,
    };
  }

  private _parseContentJson(content: string): Record<string, any> {
    try {
      return content ? JSON.parse(content) : {};
    } catch {
      return {};
    }
  }

  private _extractPostContent(contentJson: Record<string, any>): { text: string; imageKeys: string[] } {
    const parseBlock = (block: any): { text: string; imageKeys: string[] } => {
      if (!block || !Array.isArray(block.content)) {
        return { text: '', imageKeys: [] };
      }
      const texts: string[] = [];
      const images: string[] = [];
      if (block.title) {
        texts.push(block.title);
      }
      for (const row of block.content) {
        if (!Array.isArray(row)) {
          continue;
        }
        for (const el of row) {
          if (!el || typeof el !== 'object') {
            continue;
          }
          const tag = el.tag;
          if (tag === 'text' || tag === 'a') {
            if (el.text) texts.push(el.text);
          } else if (tag === 'at') {
            texts.push(`@${el.user_name || 'user'}`);
          } else if (tag === 'img' && el.image_key) {
            images.push(el.image_key);
          }
        }
      }
      return { text: texts.join(' ').trim(), imageKeys: images };
    };

    let root: any = contentJson;
    if (root && typeof root === 'object' && root.post && typeof root.post === 'object') {
      root = root.post;
    }
    if (!root || typeof root !== 'object') {
      return { text: '', imageKeys: [] };
    }
    if (root.content) {
      return parseBlock(root);
    }
    const locales = ['zh_cn', 'en_us', 'ja_jp'];
    for (const key of locales) {
      if (root[key]) {
        const parsed = parseBlock(root[key]);
        if (parsed.text || parsed.imageKeys.length > 0) {
          return parsed;
        }
      }
    }
    for (const value of Object.values(root)) {
      if (value && typeof value === 'object') {
        const parsed = parseBlock(value);
        if (parsed.text || parsed.imageKeys.length > 0) {
          return parsed;
        }
      }
    }
    return { text: '', imageKeys: [] };
  }

  private _getMediaDir(): string {
    return path.join(os.homedir(), '.octobot', 'media');
  }

  private async _downloadAndSaveMedia(
    messageType: string,
    contentJson: Record<string, any>,
    messageId: string
  ): Promise<{ filePath: string | null; note: string }> {
    const fileKey = messageType === 'image' ? contentJson.image_key : contentJson.file_key;
    if (!fileKey || !messageId) {
      return { filePath: null, note: `[${messageType}: missing key]` };
    }

    const fileName = this._resolveFileName(messageType, contentJson, fileKey, messageId);
    const mediaDir = this._getMediaDir();
    await fs.mkdir(mediaDir, { recursive: true });
    const filePath = path.join(mediaDir, fileName);

    try {
      const res = await this.client.im.messageResource.get({
        params: { type: messageType },
        path: {
          message_id: messageId,
          file_key: fileKey,
        },
      });
      await res.writeFile(filePath);
      return { filePath, note: `[${messageType}: ${filePath}]` };
    } catch (error) {
      console.error(`Error downloading ${messageType} ${fileKey}:`, error);
      return { filePath: null, note: `[${messageType}: download failed]` };
    }
  }

  private _resolveFileName(
    messageType: string,
    contentJson: Record<string, any>,
    fileKey: string,
    messageId: string
  ): string {
    const fromContent = contentJson.file_name || contentJson.fileName || contentJson.name;
    if (fromContent) {
      return `${messageId}_${fromContent}`;
    }
    const extMap: Record<string, string> = {
      image: '.jpg',
      audio: '.opus',
      media: '.mp4',
      file: '',
    };
    const ext = extMap[messageType] ?? '';
    const shortKey = fileKey.slice(0, 16);
    return `${messageId}_${shortKey}${ext}`;
  }

  private async _addReaction(messageId: string, emojiType: string): Promise<void> {
    try {
      await this.client.im.messageReaction.create({
        path: {
          message_id: messageId,
        },
        data: {
          reaction_type: {
            emoji_type: emojiType,
          },
        },
      });
      console.log(`✅ Added reaction ${emojiType} to message ${messageId}`);
    } catch (error) {
      console.error('Error adding reaction:', error);
    }
  }

  private async _sendMessage(chatId: string, content: string, metadata?: Record<string, any>): Promise<void> {
    let finalContent = content;
    if (metadata?.toolExecutionDetails) {
      const details = metadata.toolExecutionDetails as Array<{
        toolName: string;
        params: any;
        result: string;
        duration: number;
      }>;

      if (details.length > 0) {
        const detailsText = details.map((d, i) => {
          const paramsStr = JSON.stringify(d.params, null, 2).substring(0, 200);
          const resultStr = d.result.substring(0, 300);
          return `[${i + 1}] 🔧 ${d.toolName}\n参数: ${paramsStr}${paramsStr.length > 200 ? '...' : ''}\n结果: ${resultStr}${resultStr.length > 300 ? '...' : ''}\n耗时: ${d.duration}ms`;
        }).join('\n\n');

        finalContent = `${content}\n\n---\n📋 工具调用详情 (${details.length}次):\n${detailsText}`;
      }
    }

    const TABLE_RE = /((?:^[ \t]*\|.+\|[ \t]*\n)(?:^[ \t]*\|[-:\s|]+\|[ \t]*\n)(?:^[ \t]*\|.+\|[ \t]*\n?)+)/gm;
    const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
    const CODE_BLOCK_RE = /(```[\s\S]*?```)/gm;

    const parseMdTable = (tableText: string): any | null => {
      const lines = tableText
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      if (lines.length < 3) return null;
      const split = (line: string) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
      const headers = split(lines[0]);
      const rows = lines.slice(2).map(split);
      const columns = headers.map((h, i) => ({ tag: 'column', name: `c${i}`, display_name: h, width: 'auto' }));
      return {
        tag: 'table',
        page_size: rows.length + 1,
        columns,
        rows: rows.map(r => Object.fromEntries(headers.map((_, i) => [`c${i}`, r[i] ?? '']))),
      };
    };

    const splitHeadings = (text: string): any[] => {
      const codeBlocks: string[] = [];
      let protectedText = text;
      let idx = 0;
      protectedText = protectedText.replace(CODE_BLOCK_RE, (m) => {
        const placeholder = `\x00CODE${idx}\x00`;
        codeBlocks.push(m);
        idx += 1;
        return placeholder;
      });
      const elements: any[] = [];
      let last = 0;
      for (const match of protectedText.matchAll(HEADING_RE)) {
        const start = match.index ?? 0;
        const before = protectedText.slice(last, start).trim();
        if (before) elements.push({ tag: 'markdown', content: before });
        const textContent = match[2].trim();
        elements.push({
          tag: 'div',
          text: { tag: 'lark_md', content: `**${textContent}**` },
        });
        last = start + match[0].length;
      }
      const remaining = protectedText.slice(last).trim();
      if (remaining) elements.push({ tag: 'markdown', content: remaining });
      for (let i = 0; i < codeBlocks.length; i++) {
        const placeholder = `\x00CODE${i}\x00`;
        for (const el of elements) {
          if (el.tag === 'markdown' && typeof el.content === 'string') {
            el.content = el.content.replace(placeholder, codeBlocks[i]);
          }
        }
      }
      return elements.length > 0 ? elements : [{ tag: 'markdown', content: text }];
    };

    const buildCardElements = (s: string): any[] => {
      const elements: any[] = [];
      let lastEnd = 0;
      for (const match of s.matchAll(TABLE_RE)) {
        const start = match.index ?? 0;
        const before = s.slice(lastEnd, start);
        if (before.trim()) elements.push(...splitHeadings(before));
        elements.push(parseMdTable(match[1]) || { tag: 'markdown', content: match[1] });
        lastEnd = start + match[0].length;
      }
      const remaining = s.slice(lastEnd);
      if (remaining.trim()) elements.push(...splitHeadings(remaining));
      return elements.length > 0 ? elements : [{ tag: 'markdown', content: s }];
    };

    const receiveIdType = chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    const card = { config: { wide_screen_mode: true }, elements: buildCardElements(finalContent) };
    const res = await this.client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    });

    if (res.code !== 0) {
      console.error(`Failed to send message: ${res.msg}`);
    } else {
      console.log(`✅ Sent response to ${chatId}`);
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
