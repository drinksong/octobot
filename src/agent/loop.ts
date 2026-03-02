import { ContextBuilder } from './context';
import { ToolRegistry } from './tools/registry';
import { LLMProvider, ChatMessage } from '../providers/llm';
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool, ExecTool } from './tools/filesystem';
import { WebSearchTool } from './tools/web_search';
import { MessageTool } from './tools/message';
import { MessageBus, InboundMessage, OutboundMessage, createOutboundMessage } from '../bus';
import { SessionManager, Session, SessionMessage, addMessage, getHistory } from '../session';
import { MemoryManager } from '../memory';

export class AgentLoop {
  private maxIterations = 40;
  private memoryWindow = 100;
  private context: ContextBuilder;
  private tools: ToolRegistry;
  private running = false;
  private sessions: SessionManager;
  private memory: MemoryManager;

  constructor(
    private bus: MessageBus,
    private provider: LLMProvider,
    private workspace: string,
    private model: string = 'anthropic/claude-3.5-sonnet'
  ) {
    this.context = new ContextBuilder(workspace);
    this.tools = new ToolRegistry();
    this.sessions = new SessionManager(workspace);
    this.memory = new MemoryManager(workspace);
    this._registerDefaultTools();
  }

  private _registerDefaultTools(): void {
    this.tools.register(new ReadFileTool(this.workspace));
    this.tools.register(new WriteFileTool(this.workspace));
    this.tools.register(new EditFileTool(this.workspace));
    this.tools.register(new ListDirTool(this.workspace));
    this.tools.register(new ExecTool(this.workspace));
    this.tools.register(new WebSearchTool());
    this.tools.register(new MessageTool());
  }

  async run(): Promise<void> {
    this.running = true;
    console.log('🤖 Agent loop started');

    while (this.running) {
      try {
        const msg = await this.bus.consumeInbound();
        if (msg) {
          this._dispatch(msg).catch(err => {
            console.error('Error processing message:', err);
          });
        }
      } catch (error) {
        console.error('Error in agent loop:', error);
      }
    }
  }

  stop(): void {
    this.running = false;
    console.log('🤖 Agent loop stopping');
  }

  private async _dispatch(msg: InboundMessage): Promise<void> {
    try {
      const response = await this._processMessage(msg);
      if (response) {
        await this.bus.publishOutbound(response);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      await this.bus.publishOutbound(createOutboundMessage(
        msg.channel,
        msg.chatId,
        'Sorry, I encountered an error.'
      ));
    }
  }

  private async _processMessage(msg: InboundMessage): Promise<OutboundMessage | null> {
    const preview = msg.content.length > 80 
      ? msg.content.substring(0, 80) + '...' 
      : msg.content;
    console.log(`📩 Processing message from ${msg.channel}:${msg.senderId}: ${preview}`);

    const sessionKey = msg.sessionKey;
    const session = await this.sessions.getOrCreate(sessionKey);

    // 检查是否需要记忆整合
    if (session.messages.length > this.memoryWindow) {
      await this.memory.consolidate(session, this.provider, this.model, {
        threshold: this.memoryWindow,
      });
      // 保存更新后的会话（lastConsolidated 已更新）
      await this.sessions.save(session);
    }

    const history = getHistory(session, this.memoryWindow);

    const historyMessages: ChatMessage[] = history.map(m => ({
      role: m.role,
      content: m.content || undefined,
      tool_calls: m.tool_calls,
      tool_call_id: m.tool_call_id,
      name: m.name,
    } as ChatMessage));

    const initialMessages = await this.context.buildMessages(
      historyMessages,
      msg.content
    );

    const { finalContent, allMessages, toolsUsed } = await this._runAgentLoop(initialMessages);

    const updatedSession = this._saveTurn(session, allMessages, history.length, toolsUsed);
    await this.sessions.save(updatedSession);

    const responseContent = finalContent || 'No response';
    console.log(`📤 Response to ${msg.channel}:${msg.senderId}: ${responseContent.substring(0, 120)}...`);

    return createOutboundMessage(
      msg.channel,
      msg.chatId,
      responseContent,
      msg.metadata
    );
  }

  private _saveTurn(
    session: Session,
    messages: ChatMessage[],
    skip: number,
    toolsUsed: string[]
  ): Session {
    const now = new Date();
    let updatedSession = session;

    for (const m of messages.slice(skip)) {
      const entry: SessionMessage = {
        role: m.role as SessionMessage['role'],
        content: m.content || null,
        timestamp: now.toISOString(),
      };
      if (m.tool_calls) {
        entry.tool_calls = m.tool_calls;
      }
      if (m.tool_call_id) {
        entry.tool_call_id = m.tool_call_id;
      }
      if (m.name) {
        entry.name = m.name;
      }
      if (toolsUsed.length > 0) {
        entry.tools_used = toolsUsed;
      }
      updatedSession = addMessage(updatedSession, entry.role, entry.content, entry);
    }

    return updatedSession;
  }

  private async _runAgentLoop(
    initialMessages: ChatMessage[]
  ): Promise<{ finalContent: string | null; allMessages: ChatMessage[]; toolsUsed: string[] }> {
    let messages = [...initialMessages];
    let finalContent: string | null = null;
    const toolsUsed: string[] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const response = await this.provider.chat({
        messages,
        tools: this.tools.getDefinitions(),
        model: this.model,
      });

      if (response.tool_calls.length > 0) {
        // Convert to OpenAI format for messages
        const toolCallDicts = response.tool_calls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));

        messages = this.context.addAssistantMessage(
          messages,
          response.content,
          toolCallDicts
        );

        for (const toolCall of response.tool_calls) {
          toolsUsed.push(toolCall.name);

          const result = await this.tools.execute(
            toolCall.name,
            toolCall.arguments
          );

          messages = this.context.addToolResult(
            messages,
            toolCall.id,
            toolCall.name,
            result
          );
        }
      } else {
        messages = this.context.addAssistantMessage(
          messages,
          response.content
        );
        finalContent = response.content;
        break;
      }
    }

    if (finalContent === null) {
      finalContent = `I reached the maximum number of iterations (${this.maxIterations}) without completing the task.`;
    }

    return { finalContent, allMessages: messages, toolsUsed };
  }

  async processDirect(content: string, sessionKey: string = 'cli:direct'): Promise<string> {
    const msg: InboundMessage = {
      channel: 'cli',
      senderId: 'user',
      chatId: 'direct',
      content,
      media: [],
      metadata: {},
      sessionKey,
    };

    const response = await this._processMessage(msg);
    return response?.content || '';
  }
}
