import { Tool, ToolParams } from './base';

export interface ToolExecutionLog {
  toolName: string;
  params: ToolParams;
  result: string;
  timestamp: Date;
  duration: number;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private executionLogs: ToolExecutionLog[] = [];
  private maxLogs = 100;

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): any[] {
    return Array.from(this.tools.values()).map(t => t.toSchema());
  }

  async execute(name: string, params: ToolParams): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Tool '${name}' not found`;
    }

    const errors = tool.validateParams(params);
    if (errors.length > 0) {
      return `Error: ${errors.join('; ')}`;
    }

    const startTime = Date.now();
    const timestamp = new Date();

    try {
      console.log(`🔧 Executing tool: ${name}`);
      console.log(`   Params: ${JSON.stringify(params, null, 2)}`);

      const result = await tool.execute(params);
      const duration = Date.now() - startTime;

      console.log(`   Result (${duration}ms): ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);

      this.executionLogs.push({
        toolName: name,
        params,
        result,
        timestamp,
        duration,
      });

      if (this.executionLogs.length > this.maxLogs) {
        this.executionLogs = this.executionLogs.slice(-this.maxLogs);
      }

      return result;
    } catch (e) {
      const duration = Date.now() - startTime;
      const errorMsg = `Error executing ${name}: ${e}`;
      console.error(`   Error (${duration}ms): ${errorMsg}`);

      this.executionLogs.push({
        toolName: name,
        params,
        result: errorMsg,
        timestamp,
        duration,
      });

      return errorMsg;
    }
  }

  get toolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getExecutionLogs(): ToolExecutionLog[] {
    return [...this.executionLogs];
  }

  clearExecutionLogs(): void {
    this.executionLogs = [];
  }

  getRecentLogs(count: number = 10): ToolExecutionLog[] {
    return this.executionLogs.slice(-count);
  }
}
