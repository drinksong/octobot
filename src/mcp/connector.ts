/**
 * MCP 连接器
 *
 * 负责在 Agent 启动时连接到配置的 MCP 服务器，
 * 并将 MCP 工具注册到 ToolRegistry。
 */

import { MCPServerConfig } from './types';
import { MCPClient } from './client';
import { MCPToolWrapper, MCPManager } from '../agent/tools/mcp';
import { ToolRegistry } from '../agent/tools/registry';

/**
 * MCP 连接器
 */
export class MCPConnector {
  private client: MCPClient;
  private manager: MCPManager;

  constructor() {
    this.client = new MCPClient();
    this.manager = new MCPManager();
  }

  /**
   * 连接到配置的 MCP 服务器并注册工具
   */
  async connectServers(
    configs: MCPServerConfig[],
    registry: ToolRegistry
  ): Promise<void> {
    console.log(`🔗 Connecting to ${configs.length} MCP servers...`);

    for (const config of configs) {
      try {
        await this.connectServer(config, registry);
      } catch (error) {
        console.error(`[MCP] Failed to connect to server '${config.name}':`, error);
      }
    }

    const toolCount = this.manager.getAllTools().length;
    console.log(`🔗 MCP: ${toolCount} tools registered from ${this.client.listConnectedServers().length} servers`);
  }

  /**
   * 连接单个 MCP 服务器
   */
  private async connectServer(
    config: MCPServerConfig,
    registry: ToolRegistry
  ): Promise<void> {
    console.log(`[MCP] Connecting to server: ${config.name}`);

    // 连接到服务器
    const session = await this.client.connect(config);

    // 获取工具列表
    const tools = await session.listTools();

    // 包装并注册每个工具
    for (const toolDef of tools.tools) {
      const wrapper = new MCPToolWrapper(
        session,
        config.name,
        toolDef,
        config.toolTimeout || 30
      );

      this.manager.registerTool(wrapper);
      registry.register(wrapper);

      console.log(`[MCP] Registered tool: ${wrapper.name}`);
    }

    console.log(`[MCP] Server '${config.name}': connected, ${tools.tools.length} tools registered`);
  }

  /**
   * 断开所有 MCP 连接
   */
  async disconnectAll(): Promise<void> {
    await this.client.disconnectAll();
    this.manager.clear();
    console.log('[MCP] All servers disconnected');
  }

  /**
   * 获取已注册的所有 MCP 工具
   */
  getAllTools(): MCPToolWrapper[] {
    return this.manager.getAllTools();
  }
}
