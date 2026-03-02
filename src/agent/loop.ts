import { ContextBuilder } from './context';
import { ToolRegistry } from './tools/registry';
import { LLMProvider, ChatMessage } from '../providers/llm';
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool, ExecTool } from './tools/filesystem';
import { WebSearchTool } from './tools/web_search';
import { WebFetchTool } from './tools/web_fetch';
import { MessageTool } from './tools/message';
import { SpawnTool } from './tools/spawn';
import { CronTool } from './tools/cron';
import { MessageBus, InboundMessage, OutboundMessage, createOutboundMessage } from '../bus';
import { SessionManager, Session, SessionMessage, addMessage, getHistory } from '../session';
import { MemoryManager } from '../memory';
import { SubagentManager } from './subagent';
import { HeartbeatService } from '../heartbeat/service';
import { CronService } from '../cron/service';
import { MCPConnector } from '../mcp/connector';
import { MCPServerConfig } from '../mcp/types';

export class AgentLoop {
  private maxIterations = 40;
  private memoryWindow = 100;
  private context: ContextBuilder;
  private tools: ToolRegistry;
  private running = false;
  private sessions: SessionManager;
  private memory: MemoryManager;
  private subagents: SubagentManager;
  private spawnTool: SpawnTool;
  private heartbeat: HeartbeatService;
  private cron: CronService;
  private cronTool: CronTool;
  private mcpConnector: MCPConnector;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(
    private bus: MessageBus,
    private provider: LLMProvider,
    private workspace: string,
    private model: string = 'anthropic/claude-3.5-sonnet',
    private enableHeartbeat: boolean = false,
    private mcpConfigs?: MCPServerConfig[]
  ) {
    this.context = new ContextBuilder(workspace);
    this.tools = new ToolRegistry();
    this.sessions = new SessionManager(workspace);
    this.memory = new MemoryManager(workspace);
    this.subagents = new SubagentManager(
      provider,
      workspace,
      bus,
      model
    );
    this.spawnTool = new SpawnTool(this.subagents);
    this.cron = new CronService(
      `${workspace}/cron.json`,
      this._executeCronJob.bind(this)
    );
    this.cronTool = new CronTool(this.cron);
    this.heartbeat = new HeartbeatService(
      workspace,
      provider,
      model,
      {
        onExecute: this._executeHeartbeatTasks.bind(this),
        onNotify: this._notifyHeartbeatResult.bind(this),
      },
      30 * 60 * 1000, // 30 minutes
      enableHeartbeat
    );
    this.mcpConnector = new MCPConnector();
    this._registerDefaultTools();
  }

  private _registerDefaultTools(): void {
    this.tools.register(new ReadFileTool(this.workspace));
    this.tools.register(new WriteFileTool(this.workspace));
    this.tools.register(new EditFileTool(this.workspace));
    this.tools.register(new ListDirTool(this.workspace));
    this.tools.register(new ExecTool(this.workspace));
    this.tools.register(new WebSearchTool());
    this.tools.register(new WebFetchTool());
    this.tools.register(new MessageTool());
    this.tools.register(this.spawnTool);
    this.tools.register(this.cronTool);
  }

  async run(): Promise<void> {
    this.running = true;
    console.log('🤖 Agent loop started');

    // Connect to MCP servers if configured
    if (this.mcpConfigs && this.mcpConfigs.length > 0) {
      await this.mcpConnector.connectServers(this.mcpConfigs, this.tools);
    }

    // Start services
    this.cron.start();
    this.heartbeat.start();

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

    // Stop services
    this.cron.stop();
    this.heartbeat.stop();
  }

  stop(): void {
    this.running = false;
    this.cron.stop();
    this.heartbeat.stop();
    this.mcpConnector.disconnectAll();
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

    // 设置工具上下文
    this.spawnTool.setContext(msg.channel, msg.chatId, msg.sessionKey);
    this.cronTool.setContext(msg.channel, msg.chatId);

    // 处理特殊命令
    const commandResult = await this._handleCommand(msg);
    if (commandResult) {
      return commandResult;
    }

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

    // 创建 AbortController 用于取消任务
    const controller = new AbortController();
    this.abortControllers.set(sessionKey, controller);

    try {
      const { finalContent, allMessages, toolsUsed } = await this._runAgentLoop(initialMessages, controller.signal);

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
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return createOutboundMessage(
          msg.channel,
          msg.chatId,
          '⏹️ Task was cancelled.',
          msg.metadata
        );
      }
      throw error;
    } finally {
      this.abortControllers.delete(sessionKey);
    }
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
    initialMessages: ChatMessage[],
    signal?: AbortSignal
  ): Promise<{ finalContent: string | null; allMessages: ChatMessage[]; toolsUsed: string[] }> {
    let messages = [...initialMessages];
    let finalContent: string | null = null;
    const toolsUsed: string[] = [];

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      // 检查是否被取消
      if (signal?.aborted) {
        throw new Error('AbortError');
      }

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
          // 检查是否被取消
          if (signal?.aborted) {
            throw new Error('AbortError');
          }

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

  /**
   * 处理特殊命令（以 / 开头）
   */
  private async _handleCommand(msg: InboundMessage): Promise<OutboundMessage | null> {
    const content = msg.content.trim();
    
    // 只处理以 / 开头的命令
    if (!content.startsWith('/')) {
      return null;
    }

    const parts = content.split(' ');
    const command = parts[0].toLowerCase();

    switch (command) {
      case '/new':
        return this._handleNewCommand(msg);
      case '/stop':
        return this._handleStopCommand(msg);
      case '/help':
        return this._handleHelpCommand(msg);
      default:
        return createOutboundMessage(
          msg.channel,
          msg.chatId,
          `Unknown command: ${command}\nType /help for available commands.`
        );
    }
  }

  /**
   * /new - 创建新会话
   */
  private async _handleNewCommand(msg: InboundMessage): Promise<OutboundMessage> {
    // 生成新的会话 key
    const timestamp = Date.now();
    const newSessionKey = `${msg.channel}:${msg.senderId}:${timestamp}`;
    
    // 创建新会话
    await this.sessions.getOrCreate(newSessionKey);
    
    return createOutboundMessage(
      msg.channel,
      msg.chatId,
      `🆕 New session started: ${newSessionKey}\nYou can now start a fresh conversation.`
    );
  }

  /**
   * /stop - 停止当前任务
   */
  private async _handleStopCommand(msg: InboundMessage): Promise<OutboundMessage> {
    const sessionKey = msg.sessionKey;
    const controller = this.abortControllers.get(sessionKey);

    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionKey);
      return createOutboundMessage(
        msg.channel,
        msg.chatId,
        '⏹️ Task cancelled by user.'
      );
    }

    return createOutboundMessage(
      msg.channel,
      msg.chatId,
      '⏹️ No active task to cancel.'
    );
  }

  /**
   * /help - 显示帮助信息
   */
  private async _handleHelpCommand(msg: InboundMessage): Promise<OutboundMessage> {
    const helpText = `🐙 **octobot Commands**

**Special Commands:**
- \`/new\` - Start a new session (clear conversation history)
- \`/stop\` - Stop the current task (coming soon)
- \`/help\` - Show this help message

**Available Tools:**
- \`read_file\` - Read file contents
- \`write_file\` - Write to a file
- \`edit_file\` - Edit file contents
- \`list_dir\` - List directory contents
- \`exec\` - Execute shell commands
- \`web_search\` - Search the web
- \`spawn\` - Create background subagent

**Tips:**
- I can remember our conversations using the memory system
- Use skills to extend my capabilities
- Type naturally and I'll use tools when needed`;

    return createOutboundMessage(
      msg.channel,
      msg.chatId,
      helpText
    );
  }

  /**
   * Execute heartbeat tasks.
   */
  private async _executeHeartbeatTasks(tasks: string): Promise<string> {
    // Create a temporary session for heartbeat execution
    const sessionKey = 'heartbeat:system';
    const session = await this.sessions.getOrCreate(sessionKey);

    // Build messages
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
      `Heartbeat check: ${tasks}`
    );

    const { finalContent } = await this._runAgentLoop(initialMessages);
    return finalContent || 'Heartbeat tasks completed.';
  }

  /**
   * Notify heartbeat result.
   */
  private async _notifyHeartbeatResult(response: string): Promise<void> {
    // For now, just log the result
    // In a real implementation, you might send this to a notification channel
    console.log('⏱️ Heartbeat result:', response);
  }

  /**
   * Execute a cron job.
   */
  private async _executeCronJob(job: import('../cron/types').CronJob): Promise<string | null> {
    const sessionKey = `cron:${job.id}`;
    const session = await this.sessions.getOrCreate(sessionKey);

    // Build messages
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
      `Scheduled task: ${job.payload.message}`
    );

    const { finalContent } = await this._runAgentLoop(initialMessages);

    // Deliver if requested
    if (job.payload.deliver && job.payload.channel && job.payload.to) {
      await this.bus.publishOutbound(createOutboundMessage(
        job.payload.channel,
        job.payload.to,
        finalContent || 'Task completed.'
      ));
    }

    return finalContent;
  }
}
