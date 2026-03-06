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

function expandHome(input: string): string {
  return input.startsWith('~') ? path.join(os.homedir(), input.slice(1)) : input;
}

export async function initWorkspace(workspacePath: string): Promise<void> {
  const expandedPath = expandHome(workspacePath);
  await fs.mkdir(expandedPath, { recursive: true });
  const subdirs = ['sessions', 'memory', 'skills'];
  for (const dir of subdirs) {
    await fs.mkdir(path.join(expandedPath, dir), { recursive: true });
  }
  console.log(`📁 Workspace initialized: ${expandedPath}`);
}

function resolveProvider(config: Config): {
  apiKey: string;
  apiBase: string;
  providerName: string;
  model: string;
  workspace: string;
} {
  const model = config.agents.defaults.model;
  const workspace = config.agents.defaults.workspace;
  let providerName = config.agents.defaults.provider;
  let providerConfig = config.providers[providerName];
  let apiKey = providerConfig?.api_key || providerConfig?.apiKey || '';
  let apiBase = providerConfig?.api_base || providerConfig?.apiBase || '';

  if (providerName === 'auto' || !apiKey) {
    for (const [name, cfg] of Object.entries(config.providers)) {
      const key = cfg.api_key || cfg.apiKey;
      if (key) {
        providerName = name;
        providerConfig = cfg;
        apiKey = key;
        apiBase = cfg.api_base || cfg.apiBase || '';
        console.log(`🔍 Auto-detected provider: ${name}`);
        break;
      }
    }
  }

  return { apiKey, apiBase, providerName, model, workspace };
}

function buildMcpConfigs(config: Config): any[] | undefined {
  if (!config.mcp?.enabled || !config.mcp.servers) {
    return undefined;
  }
  const mcpConfigs = Object.entries(config.mcp.servers).map(([name, cfg]) => ({
    name,
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
    url: cfg.url,
    headers: cfg.headers,
    toolTimeout: cfg.tool_timeout || cfg.toolTimeout || 30,
  }));
  console.log(`🔗 MCP: ${mcpConfigs.length} servers configured`);
  return mcpConfigs;
}

async function buildRuntime(config: Config) {
  const { apiKey, apiBase, providerName, model, workspace } = resolveProvider(config);

  if (!apiKey) {
    console.error('❌ No LLM API key found in config.json');
    console.error('   Please add an API key to config.json under providers.{provider_name}.api_key');
    process.exit(1);
  }

  console.log(`\n🚀 octobot starting...`);
  console.log(`📦 Model: ${model}`);
  console.log(`🔑 Provider: ${providerName}`);
  console.log(`📁 Workspace: ${workspace}`);

  const bus = new MessageBus();
  const mcpConfigs = buildMcpConfigs(config);
  const provider = new LLMProvider(apiKey, apiBase, model, providerName);
  const agent = new AgentLoop(
    bus,
    provider,
    workspace,
    model,
    false,
    mcpConfigs,
    config.tools,
    config.channels,
    (config.agents.defaults.max_tool_iterations as any) ?? (config.agents.defaults.maxToolIterations as any)
  );

  return { bus, agent, config };
}

export async function startAgent(): Promise<void> {
  const config = await loadConfig();
  await initWorkspace(config.agents.defaults.workspace);
  const { bus, agent } = await buildRuntime(config);
  const cli = new CLIChannel(bus);
  await Promise.all([agent.run(), cli.start()]);
}

export async function startGateway(): Promise<void> {
  const config = await loadConfig();
  await initWorkspace(config.agents.defaults.workspace);
  const { bus, agent } = await buildRuntime(config);

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
  await Promise.all([agent.run(), feishuChannel.start()]);
}

export async function startFromEnv(): Promise<void> {
  const mode = process.env.MODE || 'cli';
  if (mode === 'feishu') {
    await startGateway();
    return;
  }
  await startAgent();
}
