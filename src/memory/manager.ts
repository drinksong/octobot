/**
 * 记忆管理器
 *
 * 实现双层记忆系统：
 * 1. MEMORY.md - 长期事实记忆
 * 2. HISTORY.md - 可搜索历史
 *
 * 提供记忆整合功能，自动将旧对话总结并归档
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LLMProvider } from '../providers/llm';
import { Session } from '../session';
import {
  MemoryStore,
  MemoryConsolidationResult,
  ConsolidationOptions,
  SAVE_MEMORY_TOOL,
  DEFAULT_MEMORY_TEMPLATE,
  DEFAULT_HISTORY_TEMPLATE,
} from './types';

export class MemoryManager {
  private store: MemoryStore;

  constructor(workspace: string) {
    const expandedWorkspace = this.expandPath(workspace);
    const memoryDir = path.join(expandedWorkspace, 'memory');
    this.store = {
      memoryFile: path.join(memoryDir, 'MEMORY.md'),
      historyFile: path.join(memoryDir, 'HISTORY.md'),
    };
  }

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  private async ensureDir(): Promise<void> {
    const dir = path.dirname(this.store.memoryFile);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // 目录已存在，忽略错误
    }
  }

  /**
   * 读取长期记忆（MEMORY.md）
   */
  async readLongTerm(): Promise<string> {
    try {
      return await fs.readFile(this.store.memoryFile, 'utf-8');
    } catch (error) {
      // 文件不存在，返回默认模板
      return DEFAULT_MEMORY_TEMPLATE;
    }
  }

  /**
   * 写入长期记忆（MEMORY.md）
   */
  async writeLongTerm(content: string): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.store.memoryFile, content, 'utf-8');
  }

  /**
   * 追加历史记录（HISTORY.md）
   */
  async appendHistory(entry: string): Promise<void> {
    await this.ensureDir();
    const formattedEntry = entry.trim() + '\n\n';
    await fs.appendFile(this.store.historyFile, formattedEntry, 'utf-8');
  }

  /**
   * 读取历史记录（HISTORY.md）
   */
  async readHistory(): Promise<string> {
    try {
      return await fs.readFile(this.store.historyFile, 'utf-8');
    } catch (error) {
      // 文件不存在，返回默认模板
      return DEFAULT_HISTORY_TEMPLATE;
    }
  }

  /**
   * 获取记忆上下文（用于插入到系统提示）
   */
  async getMemoryContext(): Promise<string> {
    const longTerm = await this.readLongTerm();
    if (!longTerm || longTerm === DEFAULT_MEMORY_TEMPLATE) {
      return '';
    }
    return `## Long-term Memory\n${longTerm}\n\n`;
  }

  /**
   * 整合记忆
   *
   * 将旧消息总结并归档到 MEMORY.md 和 HISTORY.md
   *
   * @param session 会话对象
   * @param provider LLM 提供者
   * @param model 模型名称
   * @param options 整合选项
   * @returns 是否成功
   */
  async consolidate(
    session: Session,
    provider: LLMProvider,
    model: string,
    options: ConsolidationOptions = {}
  ): Promise<boolean> {
    const { archiveAll = false, keepCount: userKeepCount, threshold = 50 } = options;

    // 计算需要归档的消息
    let oldMessages: typeof session.messages;
    let keepCount: number;

    if (archiveAll) {
      // 归档所有消息
      oldMessages = session.messages;
      keepCount = 0;
      console.log(`Memory consolidation (archive_all): ${session.messages.length} messages`);
    } else {
      // 只归档旧消息，保留最近的部分
      keepCount = userKeepCount ?? Math.floor(threshold / 2);
      if (session.messages.length <= keepCount) {
        return true; // 消息太少，不需要整合
      }
      if (session.messages.length - session.lastConsolidated <= 0) {
        return true; // 没有新消息需要整合
      }
      // 只归档 lastConsolidated 到 -keepCount 之间的消息
      oldMessages = session.messages.slice(session.lastConsolidated, -keepCount);
      if (oldMessages.length === 0) {
        return true;
      }
      console.log(
        `Memory consolidation: ${oldMessages.length} to consolidate, ${keepCount} keep`
      );
    }

    // 构建对话文本
    const lines: string[] = [];
    for (const m of oldMessages) {
      if (!m.content) continue;
      const tools = m.tools_used ? ` [tools: ${m.tools_used.join(', ')}]` : '';
      const timestamp = m.timestamp ? m.timestamp.slice(0, 16) : '?';
      lines.push(`[${timestamp}] ${m.role.toUpperCase()}${tools}: ${m.content}`);
    }

    const currentMemory = await this.readLongTerm();
    const prompt = `Process this conversation and call the save_memory tool with your consolidation.

## Current Long-term Memory
${currentMemory}

## Conversation to Process
${lines.join('\n')}`;

    try {
      // 调用 LLM 进行整合
      const response = await provider.chat({
        messages: [
          {
            role: 'system',
            content:
              'You are a memory consolidation agent. Call the save_memory tool with your consolidation of the conversation.',
          },
          { role: 'user', content: prompt },
        ],
        tools: [SAVE_MEMORY_TOOL],
        model,
        temperature: 0.3,
      });

      // 检查是否调用了工具
      if (!response.tool_calls || response.tool_calls.length === 0) {
        console.warn('Memory consolidation: LLM did not call save_memory, skipping');
        return false;
      }

      const toolCall = response.tool_calls[0];
      const args = toolCall.arguments;

      if (typeof args !== 'object' || args === null) {
        console.warn('Memory consolidation: unexpected arguments type');
        return false;
      }

      // 保存历史条目
      const historyEntry = args.history_entry;
      if (historyEntry && typeof historyEntry === 'string') {
        await this.appendHistory(historyEntry);
      }

      // 更新长期记忆
      const memoryUpdate = args.memory_update;
      if (memoryUpdate && typeof memoryUpdate === 'string') {
        if (memoryUpdate !== currentMemory) {
          await this.writeLongTerm(memoryUpdate);
        }
      }

      // 更新会话的 lastConsolidated
      session.lastConsolidated = archiveAll
        ? 0
        : Math.max(0, session.messages.length - keepCount);

      console.log(
        `Memory consolidation done: ${session.messages.length} messages, lastConsolidated=${session.lastConsolidated}`
      );
      return true;
    } catch (error) {
      console.error('Memory consolidation failed:', error);
      return false;
    }
  }

  /**
   * 搜索历史记录
   *
   * @param keyword 搜索关键词
   * @returns 匹配的行
   */
  async searchHistory(keyword: string): Promise<string[]> {
    try {
      const content = await this.readHistory();
      const lines = content.split('\n');
      const lowerKeyword = keyword.toLowerCase();
      return lines.filter((line) => line.toLowerCase().includes(lowerKeyword));
    } catch (error) {
      return [];
    }
  }
}
