/**
 * Heartbeat service - periodic agent wake-up to check for tasks.
 *
 * The heartbeat service wakes the agent periodically to check HEARTBEAT.md
 * for active tasks. If tasks are found, the agent executes them.
 */

import { LLMProvider } from '../providers/llm';

// Virtual tool for heartbeat decision
const HEARTBEAT_TOOL = [
  {
    type: 'function',
    function: {
      name: 'heartbeat',
      description: 'Report heartbeat decision after reviewing tasks.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['skip', 'run'],
            description: 'skip = nothing to do, run = has active tasks',
          },
          tasks: {
            type: 'string',
            description: 'Natural-language summary of active tasks (required for run)',
          },
        },
        required: ['action'],
      },
    },
  },
];

export interface HeartbeatCallbacks {
  onExecute?: (tasks: string) => Promise<string>;
  onNotify?: (response: string) => Promise<void>;
}

export class HeartbeatService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private workspace: string,
    private provider: LLMProvider,
    private model: string,
    private callbacks: HeartbeatCallbacks = {},
    private intervalMs: number = 30 * 60 * 1000, // 30 minutes
    private enabled: boolean = true
  ) {}

  /**
   * Get the heartbeat file path.
   */
  private get heartbeatFile(): string {
    return `${this.workspace}/HEARTBEAT.md`;
  }

  /**
   * Ensure heartbeat file exists with template.
   */
  private ensureHeartbeatFile(): void {
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.heartbeatFile)) {
        const template = `# Heartbeat Tasks

This file is checked every 30 minutes by your octobot agent.
Add tasks below that you want the agent to work on periodically.

If this file has no tasks (only headers and comments), the agent will skip the heartbeat.

## Active Tasks

<!-- Add your periodic tasks below this line -->


## Completed

<!-- Move completed tasks here or delete them -->
`;
        fs.writeFileSync(this.heartbeatFile, template, 'utf-8');
        console.log('⏱️ Created HEARTBEAT.md');
      }
    } catch (error) {
      console.error('Error creating heartbeat file:', error);
    }
  }

  /**
   * Read the heartbeat file content.
   */
  private readHeartbeatFile(): string | null {
    try {
      const fs = require('fs');
      this.ensureHeartbeatFile();
      return fs.readFileSync(this.heartbeatFile, 'utf-8');
    } catch (error) {
      console.error('Error reading heartbeat file:', error);
      return null;
    }
  }

  /**
   * Start the heartbeat service.
   */
  start(): void {
    if (!this.enabled) {
      console.log('⏱️ Heartbeat disabled');
      return;
    }
    if (this.running) {
      console.log('⏱️ Heartbeat already running');
      return;
    }

    this.running = true;
    console.log(`⏱️ Heartbeat started (every ${this.intervalMs / 1000}s)`);

    // Schedule first tick
    this.scheduleNext();
  }

  /**
   * Stop the heartbeat service.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('⏱️ Heartbeat stopped');
  }

  /**
   * Schedule the next heartbeat tick.
   */
  private scheduleNext(): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      this.tick().catch(error => {
        console.error('Heartbeat tick error:', error);
      });
    }, this.intervalMs);
  }

  /**
   * Execute a single heartbeat tick.
   */
  private async tick(): Promise<void> {
    if (!this.running) return;

    const content = this.readHeartbeatFile();
    if (!content) {
      console.log('⏱️ Heartbeat: HEARTBEAT.md missing or empty');
      this.scheduleNext();
      return;
    }

    console.log('⏱️ Heartbeat: checking for tasks...');

    try {
      const { action, tasks } = await this.decide(content);

      if (action !== 'run') {
        console.log('⏱️ Heartbeat: OK (nothing to report)');
        this.scheduleNext();
        return;
      }

      console.log('⏱️ Heartbeat: tasks found, executing...');
      if (this.callbacks.onExecute && tasks) {
        const response = await this.callbacks.onExecute(tasks);
        if (response && this.callbacks.onNotify) {
          console.log('⏱️ Heartbeat: completed, delivering response');
          await this.callbacks.onNotify(response);
        }
      }
    } catch (error) {
      console.error('⏱️ Heartbeat execution failed:', error);
    }

    this.scheduleNext();
  }

  /**
   * Ask LLM to decide whether to skip or run.
   */
  private async decide(content: string): Promise<{ action: string; tasks: string }> {
    const response = await this.provider.chat({
      messages: [
        {
          role: 'system',
          content: 'You are a heartbeat agent. Call the heartbeat tool to report your decision.',
        },
        {
          role: 'user',
          content: `Review the following HEARTBEAT.md and decide whether there are active tasks.\n\n${content}`,
        },
      ],
      tools: HEARTBEAT_TOOL,
      model: this.model,
    });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return { action: 'skip', tasks: '' };
    }

    const args = response.tool_calls[0].function.arguments;
    return {
      action: args.action || 'skip',
      tasks: args.tasks || '',
    };
  }

  /**
   * Manually trigger a heartbeat.
   */
  async triggerNow(): Promise<string | null> {
    const content = this.readHeartbeatFile();
    if (!content) return null;

    const { action, tasks } = await this.decide(content);
    if (action !== 'run' || !this.callbacks.onExecute) {
      return null;
    }

    return await this.callbacks.onExecute(tasks);
  }
}
