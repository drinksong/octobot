/**
 * MCP 工具包装器
 *
 * 将 MCP 服务器提供的工具包装为 Agent 可用的 Tool。
 */

import { Tool, ToolParams } from './base';
import { MCPSession, MCPToolDefinition } from '../../mcp/types';

/**
 * MCP 工具包装器
 *
 * 包装单个 MCP 工具，使其可以被 Agent 调用
 */
export class MCPToolWrapper extends Tool {
  constructor(
    private session: MCPSession,
    private serverName: string,
    private toolDef: MCPToolDefinition,
    private toolTimeout: number = 30
  ) {
    super();
  }

  get name(): string {
    // 添加前缀避免命名冲突
    return `mcp_${this.serverName}_${this.toolDef.name}`;
  }

  get description(): string {
    return this.toolDef.description || `MCP tool: ${this.toolDef.name}`;
  }

  get parameters(): { type: string; properties: Record<string, any>; required?: string[] } {
    const schema = this.toolDef.inputSchema;
    return {
      type: schema?.type || 'object',
      properties: schema?.properties || {},
      required: schema?.required,
    };
  }

  async execute(params: ToolParams): Promise<string> {
    try {
      // 设置超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`MCP tool '${this.name}' timed out after ${this.toolTimeout}s`));
        }, this.toolTimeout * 1000);
      });

      // 调用 MCP 工具
      const resultPromise = this.session.callTool(this.toolDef.name, params);

      // 竞争超时
      const result = await Promise.race([resultPromise, timeoutPromise]);

      // 处理结果
      const parts: string[] = [];
      for (const block of result.content) {
        if (block.type === 'text') {
          parts.push(block.text);
        } else if (block.type === 'image') {
          parts.push(`[Image: ${block.mimeType}]`);
        } else if (block.type === 'resource') {
          parts.push(`[Resource: ${block.resource.uri}]`);
        }
      }

      return parts.join('\n') || '(no output)';
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        return `(MCP tool call timed out after ${this.toolTimeout}s)`;
      }
      return `MCP tool error: ${error}`;
    }
  }
}

/**
 * MCP 工具管理器
 *
 * 管理多个 MCP 服务器的连接和工具注册
 */
export class MCPManager {
  private wrappers: Map<string, MCPToolWrapper> = new Map();

  /**
   * 注册 MCP 工具
   */
  registerTool(wrapper: MCPToolWrapper): void {
    this.wrappers.set(wrapper.name, wrapper);
  }

  /**
   * 获取所有已注册的 MCP 工具
   */
  getAllTools(): MCPToolWrapper[] {
    return Array.from(this.wrappers.values());
  }

  /**
   * 获取特定工具
   */
  getTool(name: string): MCPToolWrapper | undefined {
    return this.wrappers.get(name);
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.wrappers.clear();
  }
}
