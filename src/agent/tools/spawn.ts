/**
 * Spawn tool for creating background subagents.
 */

import { Tool, ToolParams } from './base';
import { SubagentManager } from '../subagent';

export class SpawnTool extends Tool {
  private originChannel = 'cli';
  private originChatId = 'direct';
  private sessionKey = 'cli:direct';

  constructor(private manager: SubagentManager) {
    super();
  }

  /**
   * Set the origin context for subagent announcements.
   */
  setContext(channel: string, chatId: string, sessionKey?: string): void {
    this.originChannel = channel;
    this.originChatId = chatId;
    this.sessionKey = sessionKey || `${channel}:${chatId}`;
  }

  get name(): string {
    return 'spawn';
  }

  get description(): string {
    return (
      'Spawn a subagent to handle a task in the background. ' +
      'Use this for complex or time-consuming tasks that can run independently. ' +
      'The subagent will complete the task and report back when done.'
    );
  }

  get parameters(): { type: string; properties: Record<string, any>; required: string[] } {
    return {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task for the subagent to complete',
        },
        label: {
          type: 'string',
          description: 'Optional short label for the task (for display)',
        },
      },
      required: ['task'],
    };
  }

  async execute({ task, label }: ToolParams): Promise<string> {
    return await this.manager.spawn(
      task,
      label || null,
      this.originChannel,
      this.originChatId,
      this.sessionKey
    );
  }
}
