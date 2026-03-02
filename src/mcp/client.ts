/**
 * MCP 客户端
 *
 * 使用 @modelcontextprotocol/sdk 实现真实的 MCP 连接。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPServerConfig, MCPSession, MCPListToolsResponse, MCPCallToolResult, MCPContent } from './types';

// SDK 返回内容的类型定义
interface SDKTextContent {
  type: 'text';
  text: string;
}

interface SDKImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

interface SDKTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

interface SDKListToolsResult {
  tools: SDKTool[];
}

interface SDKCallToolResult {
  content: (SDKTextContent | SDKImageContent | { type: string; [key: string]: any })[];
  isError?: boolean;
}

/**
 * 真实的 MCP 会话实现
 */
class MCPClientSession implements MCPSession {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async initialize(): Promise<void> {
    // SDK 客户端在创建时已经初始化
  }

  async listTools(): Promise<MCPListToolsResponse> {
    const result = await this.client.listTools() as unknown as SDKListToolsResult;
    return {
      tools: result.tools.map((tool: SDKTool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  }

  async callTool(name: string, args: Record<string, any>): Promise<MCPCallToolResult> {
    const result = await this.client.callTool({
      name,
      arguments: args,
    }) as unknown as SDKCallToolResult;

    // 转换 SDK 结果到我们的类型
    const content: MCPContent[] = result.content.map((item) => {
      if (item.type === 'text') {
        const textItem = item as SDKTextContent;
        return { type: 'text' as const, text: textItem.text };
      } else if (item.type === 'image') {
        const imageItem = item as SDKImageContent;
        return {
          type: 'image' as const,
          data: imageItem.data,
          mimeType: imageItem.mimeType,
        };
      } else {
        return { type: 'text' as const, text: String(item) };
      }
    });

    return {
      content,
      isError: result.isError ?? false,
    };
  }
}

/**
 * MCP 客户端类
 *
 * 使用 @modelcontextprotocol/sdk 连接 MCP 服务器
 */
export class MCPClient {
  private sessions: Map<string, MCPClientSession> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();

  /**
   * 连接到 MCP 服务器
   */
  async connect(config: MCPServerConfig): Promise<MCPSession> {
    if (!config.command) {
      throw new Error(`MCP server '${config.name}' requires a command`);
    }

    console.log(`[MCP] Connecting to server: ${config.name}`);

    // 创建 stdio 传输
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: config.env,
    });

    this.transports.set(config.name, transport);

    // 创建客户端
    const client = new Client(
      {
        name: 'octobot-client',
        version: '1.0.0',
      },
      {
        capabilities: {},
      }
    );

    // 连接
    await client.connect(transport);

    // 创建会话
    const session = new MCPClientSession(client);
    await session.initialize();

    this.sessions.set(config.name, session);

    return session;
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    for (const [name, transport] of this.transports) {
      try {
        await transport.close();
        console.log(`[MCP] Disconnected from server: ${name}`);
      } catch (error) {
        console.error(`[MCP] Error disconnecting from ${name}:`, error);
      }
    }

    this.sessions.clear();
    this.transports.clear();
  }

  /**
   * 获取会话
   */
  getSession(name: string): MCPSession | undefined {
    return this.sessions.get(name);
  }

  /**
   * 列出所有已连接的服务器
   */
  listConnectedServers(): string[] {
    return Array.from(this.sessions.keys());
  }
}
