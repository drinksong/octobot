/**
 * mini-octobot entry point.
 * Reference: /Users/bytedance/github/octobot/octobot/__main__.py
 */

import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { LLMProvider } from './providers/llm';
import { AgentLoop } from './agent/loop';
import { CLIChannel } from './channels/cli';
import { FeishuChannel } from './channels/feishu';
import { MessageBus } from './bus';
import { loadConfig, Config } from './config';

/**
 * 初始化工作区目录
 */
async function initWorkspace(workspacePath: string): Promise<void> {
  const expandedPath = workspacePath.startsWith('~')
    ? path.join(os.homedir(), workspacePath.slice(1))
    : workspacePath;

  // 创建主工作区目录
  await fs.mkdir(expandedPath, { recursive: true });

  // 创建子目录
  const subdirs = ['sessions', 'memory', 'skills'];
  for (const dir of subdirs) {
    await fs.mkdir(path.join(expandedPath, dir), { recursive: true });
  }

  console.log(`📁 Workspace initialized: ${expandedPath}`);
}

async function main() {
  const config = await loadConfig('./config.json');

  const model = config.agents.defaults.model;
  const providerName = config.agents.defaults.provider;
  const workspace = config.agents.defaults.workspace;

  let providerConfig = config.providers[providerName];
  let apiKey = providerConfig?.api_key || providerConfig?.apiKey || '';
  let apiBase = providerConfig?.api_base || providerConfig?.apiBase || '';

  if (providerName === 'auto' || !apiKey) {
    for (const [name, cfg] of Object.entries(config.providers)) {
      const key = cfg.api_key || cfg.apiKey;
      if (key) {
        providerConfig = cfg;
        apiKey = key;
        apiBase = cfg.api_base || cfg.apiBase || '';
        console.log(`🔍 Auto-detected provider: ${name}`);
        break;
      }
    }
  }

  if (!apiKey) {
    console.error('❌ No LLM API key found in config.json');
    console.error('   Please add an API key to config.json under providers.{provider_name}.api_key');
    process.exit(1);
  }

  console.log(`\n🚀 mini-octobot starting...`);
  console.log(`📦 Model: ${model}`);
  console.log(`🔑 Provider: ${providerName}`);
  console.log(`📁 Workspace: ${workspace}`);

  // 初始化工作区
  await initWorkspace(workspace);

  const bus = new MessageBus();

  // 准备 MCP 配置
  let mcpConfigs: any[] | undefined;
  if (config.mcp?.enabled && config.mcp.servers) {
    mcpConfigs = Object.entries(config.mcp.servers).map(([name, cfg]) => ({
      name,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
      url: cfg.url,
      headers: cfg.headers,
      toolTimeout: cfg.tool_timeout || cfg.toolTimeout || 30,
    }));
    console.log(`🔗 MCP: ${mcpConfigs.length} servers configured`);
  }

  const provider = new LLMProvider(apiKey, apiBase, model, providerName);
  const agent = new AgentLoop(
    bus,
    provider,
    workspace,
    model,
    false, // enableHeartbeat
    mcpConfigs
  );

  const mode = process.env.MODE || 'cli';

  if (mode === 'feishu') {
    const feishuConfig = config.channels.feishu;

    const appId = feishuConfig.app_id || feishuConfig.appId || '';
    const appSecret = feishuConfig.app_secret || feishuConfig.appSecret || '';
    const allowFrom = feishuConfig.allow_from || feishuConfig.allowFrom || [];

    if (!feishuConfig.enabled || !appId || !appSecret) {
      console.error('❌ Feishu channel not configured in config.json');
      console.error('   Please set channels.feishu.enabled = true');
      console.error('   And provide channels.feishu.app_id and channels.feishu.app_secret');
      process.exit(1);
    }

    const feishuChannel = new FeishuChannel(bus, appId, appSecret, allowFrom);

    await Promise.all([
      agent.run(),
      feishuChannel.start(),
    ]);
  } else {
    const cli = new CLIChannel(bus);

    await Promise.all([
      agent.run(),
      cli.start(),
    ]);
  }
}

main().catch(console.error);
