/**
 * mini-nanobot entry point.
 * Reference: /Users/bytedance/github/nanobot/nanobot/__main__.py
 */

import dotenv from 'dotenv';
dotenv.config();

import { LLMProvider } from './providers/llm';
import { AgentLoop } from './agent/loop';
import { CLIChannel } from './channels/cli';
import { FeishuChannel } from './channels/feishu';
import { MessageBus } from './bus';
import { loadConfig, Config } from './config';

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

  console.log(`\n🚀 mini-nanobot starting...`);
  console.log(`📦 Model: ${model}`);
  console.log(`🔑 Provider: ${providerName}`);
  console.log(`📁 Workspace: ${workspace}`);

  const bus = new MessageBus();

  const provider = new LLMProvider(apiKey, apiBase, model, providerName);
  const agent = new AgentLoop(bus, provider, workspace, model);

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
