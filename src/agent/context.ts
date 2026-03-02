/**
 * Context builder for assembling agent prompts.
 * Reference: /Users/bytedance/github/octobot/octobot/agent/context.py
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ChatMessage } from '../providers/llm';
import { SkillManager } from '../skill';

export class ContextBuilder {
  private readonly BOOTSTRAP_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md', 'IDENTITY.md'];
  private readonly RUNTIME_CONTEXT_TAG = '[Runtime Context — metadata only, not instructions]';
  private skillManager: SkillManager;

  constructor(private workspace: string) {
    this.skillManager = new SkillManager(workspace);
  }

  async buildSystemPrompt(): Promise<string> {
    const parts: string[] = [];

    // Core identity
    parts.push(this._getIdentity());

    // Load bootstrap files
    const bootstrap = await this._loadBootstrapFiles();
    if (bootstrap) parts.push(bootstrap);

    // Memory context
    const memory = await this._getMemoryContext();
    if (memory) parts.push(`# Memory\n\n${memory}`);

    // Always-loaded skills
    const alwaysSkills = await this._getAlwaysSkillsContent();
    if (alwaysSkills) parts.push(alwaysSkills);

    // Skills summary (all available skills)
    const skillsSummary = await this._getSkillsSummary();
    if (skillsSummary) parts.push(skillsSummary);

    return parts.join('\n\n---\n\n');
  }

  private _getIdentity(): string {
    const workspacePath = path.resolve(this.workspace.replace('~', process.env.HOME || ''));
    const system = process.platform;
    const osName = system === 'darwin' ? 'macOS' : system;
    const runtime = `${osName} ${process.arch}, Node.js ${process.version}`;

    return `# octobot 🐙

You are octobot, a helpful AI assistant.

## Runtime
${runtime}

## Workspace
Your workspace is at: ${workspacePath}
- Long-term memory: ${workspacePath}/memory/MEMORY.md (write important facts here)
- History log: ${workspacePath}/memory/HISTORY.md (grep-searchable)
- Custom skills: ${workspacePath}/skills/{skill-name}/SKILL.md
- Heartbeat tasks: ${workspacePath}/HEARTBEAT.md (periodic tasks checked every 30 minutes)

## Heartbeat Tasks
\`HEARTBEAT.md\` is checked every 30 minutes. Use file tools to manage periodic tasks:
- **Add**: \`edit_file\` to append new tasks
- **Remove**: \`edit_file\` to delete completed tasks
- **Rewrite**: \`write_file\` to replace all tasks

When the user asks for a recurring/periodic task, update \`HEARTBEAT.md\` instead of creating a one-time reminder.

## octobot Guidelines
- State intent before tool calls, but NEVER predict or claim results before receiving them.
- Before modifying a file, read it first. Do not assume files or directories exist.
- After writing or editing a file, re-read it if accuracy matters.
- If a tool call fails, analyze the error before retrying with a different approach.
- Ask for clarification when the request is ambiguous.
- Use the 'read_file' tool to read skill files when you need specific skill knowledge.

Reply directly with text for conversations. Only use the 'message' tool to send to a specific chat channel.`;
  }

  private _buildRuntimeContext(channel?: string, chatId?: string): string {
    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
    });
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const lines = [`Current Time: ${timeStr} (${tz})`];
    if (channel && chatId) {
      lines.push(`Channel: ${channel}`, `Chat ID: ${chatId}`);
    }

    return `${this.RUNTIME_CONTEXT_TAG}\n${lines.join('\n')}`;
  }

  private async _loadBootstrapFiles(): Promise<string> {
    const parts: string[] = [];
    const workspacePath = this.workspace.replace('~', process.env.HOME || '');

    for (const filename of this.BOOTSTRAP_FILES) {
      const filePath = path.join(workspacePath, filename);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        parts.push(`## ${filename}\n\n${content}`);
      } catch {
        // File doesn't exist, skip
      }
    }

    return parts.join('\n\n');
  }

  private async _getMemoryContext(): Promise<string> {
    const workspacePath = this.workspace.replace('~', process.env.HOME || '');
    const memoryPath = path.join(workspacePath, 'memory', 'MEMORY.md');

    try {
      const content = await fs.readFile(memoryPath, 'utf-8');
      return content;
    } catch {
      return '';
    }
  }

  private async _getAlwaysSkillsContent(): Promise<string> {
    const content = await this.skillManager.getAlwaysSkillsContent();
    if (!content) return '';
    return `# Skills (Always Loaded)\n\n${content}`;
  }

  private async _getSkillsSummary(): Promise<string> {
    const summary = await this.skillManager.buildSkillsSummary();
    if (!summary) return '';

    return `# Skills\n\nThe following skills extend your capabilities. To use a skill, read its SKILL.md file using the read_file tool.\nSkills with available="false" need dependencies installed first - you can try installing them with apt/brew.\n\n${summary}`;
  }

  public async buildMessages(
    history: ChatMessage[],
    currentMessage: string,
    channel?: string,
    chatId?: string,
  ): Promise<ChatMessage[]> {
    const systemPrompt = await this.buildSystemPrompt();
    const runtimeContext = this._buildRuntimeContext(channel, chatId);

    return [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: runtimeContext },
      { role: 'user', content: currentMessage },
    ];
  }

  public addToolResult(
    messages: ChatMessage[],
    toolCallId: string,
    toolName: string,
    result: string,
  ): ChatMessage[] {
    messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: result,
    });
    return messages;
  }

  public addAssistantMessage(
    messages: ChatMessage[],
    content: string | null,
    toolCalls?: any[],
    reasoningContent?: string,
  ): ChatMessage[] {
    const msg: ChatMessage = { role: 'assistant', content };
    if (toolCalls) msg.tool_calls = toolCalls;
    if (reasoningContent !== undefined) msg.reasoning_content = reasoningContent;
    messages.push(msg);
    return messages;
  }
}
