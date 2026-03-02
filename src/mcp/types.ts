/**
 * MCP (Model Context Protocol) 类型定义
 *
 * MCP 是 Anthropic 推出的开放标准协议，用于连接 AI 应用与外部系统。
 */

/**
 * MCP 服务器配置
 */
export interface MCPServerConfig {
  /** 服务器名称 */
  name: string;
  /** 启动命令（stdio 模式） */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 远程 URL（HTTP 模式） */
  url?: string;
  /** HTTP 请求头 */
  headers?: Record<string, string>;
  /** 工具调用超时（秒） */
  toolTimeout?: number;
}

/**
 * MCP 工具定义
 */
export interface MCPToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description?: string;
  /** 输入参数 JSON Schema */
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCP 工具列表响应
 */
export interface MCPListToolsResponse {
  tools: MCPToolDefinition[];
}

/**
 * MCP 工具调用结果内容
 */
export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface MCPResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

/**
 * MCP 工具调用结果
 */
export interface MCPCallToolResult {
  content: MCPContent[];
  isError?: boolean;
}

/**
 * MCP 会话接口（简化版）
 */
export interface MCPSession {
  /** 初始化会话 */
  initialize(): Promise<void>;
  /** 列出可用工具 */
  listTools(): Promise<MCPListToolsResponse>;
  /** 调用工具 */
  callTool(name: string, args: Record<string, any>): Promise<MCPCallToolResult>;
}
