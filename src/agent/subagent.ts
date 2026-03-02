/**
 * Subagent manager for background task execution.
 *
 * Subagents allow long-running tasks to execute in the background
 * while the main agent continues to respond to users.
 */

import { LLMProvider, ChatMessage } from '../providers/llm';
import { ToolRegistry } from './tools/registry';
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool, ExecTool } from './tools/filesystem';
import { WebSearchTool } from './tools/web_search';
import { MessageBus, InboundMessage, createInboundMessage } from '../bus';

// Simple UUID generator
function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export interface SubagentOrigin {
  channel: string;
  chatId: string;
}

export interface SubagentTask {
  id: string;
  label: string;
  task: string;
  origin: SubagentOrigin;
  startTime: number;
}

export class SubagentManager {
  private runningTasks: Map<string, Promise<void>> = new Map();
  private sessionTasks: Map<string, Set<string>> = new Map();

  constructor(
    private provider: LLMProvider,
    private workspace: string,
    private bus: MessageBus,
    private model: string,
    private temperature: number = 0.7,
    private maxTokens: number = 4096
  ) {}

  /**
   * Spawn a subagent to execute a task in the background.
   */
  async spawn(
    task: string,
    label: string | null,
    originChannel: string,
    originChatId: string,
    sessionKey: string | null
  ): Promise<string> {
    const taskId = generateId();
    const displayLabel = label || (task.length > 30 ? task.slice(0, 30) + '...' : task);
    const origin: SubagentOrigin = { channel: originChannel, chatId: originChatId };

    // Create background task
    const bgTask = this._runSubagent(taskId, task, displayLabel, origin);

    // Track the task
    this.runningTasks.set(taskId, bgTask);
    if (sessionKey) {
      if (!this.sessionTasks.has(sessionKey)) {
        this.sessionTasks.set(sessionKey, new Set());
      }
      this.sessionTasks.get(sessionKey)!.add(taskId);
    }

    // Clean up when done
    bgTask
      .then(() => {
        this.runningTasks.delete(taskId);
        if (sessionKey) {
          this.sessionTasks.get(sessionKey)?.delete(taskId);
        }
      })
      .catch(() => {
        this.runningTasks.delete(taskId);
        if (sessionKey) {
          this.sessionTasks.get(sessionKey)?.delete(taskId);
        }
      });

    console.log(`[Subagent ${taskId}] Spawned: ${displayLabel}`);
    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`;
  }

  /**
   * Execute the subagent task.
   */
  private async _runSubagent(
    taskId: string,
    task: string,
    label: string,
    origin: SubagentOrigin
  ): Promise<void> {
    console.log(`[Subagent ${taskId}] Starting task: ${label}`);

    try {
      // Build subagent tools (no message tool, no spawn tool)
      const tools = new ToolRegistry();
      tools.register(new ReadFileTool(this.workspace));
      tools.register(new WriteFileTool(this.workspace));
      tools.register(new EditFileTool(this.workspace));
      tools.register(new ListDirTool(this.workspace));
      tools.register(new ExecTool(this.workspace));
      tools.register(new WebSearchTool());

      // Build messages with subagent-specific prompt
      const systemPrompt = this._buildSubagentPrompt(task);
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ];

      // Run agent loop (limited iterations)
      const maxIterations = 15;
      let iteration = 0;
      let finalResult: string | null = null;

      while (iteration < maxIterations) {
        iteration++;

        const response = await this.provider.chat({
          messages,
          tools: tools.getDefinitions(),
          model: this.model,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        });

        if (response.tool_calls && response.tool_calls.length > 0) {
          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: response.tool_calls,
          });

          // Execute tools
          for (const toolCall of response.tool_calls) {
            console.log(`[Subagent ${taskId}] Executing: ${toolCall.function.name}`);
            const result = await tools.execute(toolCall.function.name, toolCall.function.arguments);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: result,
            });
          }
        } else {
          finalResult = response.content;
          break;
        }
      }

      if (finalResult === null) {
        finalResult = 'Task completed but no final response was generated.';
      }

      console.log(`[Subagent ${taskId}] Completed successfully`);
      await this._announceResult(taskId, label, task, finalResult, origin, 'ok');
    } catch (error) {
      const errorMsg = `Error: ${error}`;
      console.error(`[Subagent ${taskId}] Failed:`, error);
      await this._announceResult(taskId, label, task, errorMsg, origin, 'error');
    }
  }

  /**
   * Announce the subagent result to the main agent via the message bus.
   */
  private async _announceResult(
    taskId: string,
    label: string,
    task: string,
    result: string,
    origin: SubagentOrigin,
    status: 'ok' | 'error'
  ): Promise<void> {
    const statusText = status === 'ok' ? 'completed successfully' : 'failed';

    const announceContent = `[Subagent '${label}' ${statusText}]

Task: ${task}

Result:
${result}

Summarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.`;

    // Inject as system message to trigger main agent
    const msg = createInboundMessage(
      'system',
      'subagent',
      `${origin.channel}:${origin.chatId}`,
      announceContent
    );

    await this.bus.publishInbound(msg);
    console.log(`[Subagent ${taskId}] Announced result to ${origin.channel}:${origin.chatId}`);
  }

  /**
   * Build a focused system prompt for the subagent.
   */
  private _buildSubagentPrompt(task: string): string {
    const now = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
    });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    return `# Subagent

## Current Time
${now} (${tz})

You are a subagent spawned by the main agent to complete a specific task.

## Rules
1. Stay focused - complete only the assigned task, nothing else
2. Your final response will be reported back to the main agent
3. Do not initiate conversations or take on side tasks
4. Be concise but informative in your findings

## What You Can Do
- Read and write files in the workspace
- Execute shell commands
- Search the web and fetch web pages
- Complete the task thoroughly

## What You Cannot Do
- Send messages directly to users (no message tool available)
- Spawn other subagents
- Access the main agent's conversation history

## Workspace
Your workspace is at: ${this.workspace}
Skills are available at: ${this.workspace}/skills/ (read SKILL.md files as needed)

When you have completed the task, provide a clear summary of your findings or actions.`;
  }

  /**
   * Cancel all subagents for the given session.
   */
  async cancelBySession(sessionKey: string): Promise<number> {
    const taskIds = this.sessionTasks.get(sessionKey);
    if (!taskIds) return 0;

    let cancelled = 0;
    for (const taskId of taskIds) {
      // Note: In JavaScript, we can't truly cancel a Promise
      // We just remove it from tracking
      this.runningTasks.delete(taskId);
      cancelled++;
    }
    this.sessionTasks.delete(sessionKey);

    return cancelled;
  }

  /**
   * Get the number of currently running subagents.
   */
  getRunningCount(): number {
    return this.runningTasks.size;
  }
}
