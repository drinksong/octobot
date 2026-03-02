/**
 * Configuration schema for mini-octobot.
 * Reference: /Users/bytedance/github/octobot/octobot/config/schema.py
 */

export interface ProviderConfig {
  api_key?: string;
  apiKey?: string;
  api_base?: string;
  apiBase?: string;
  extra_headers?: Record<string, string>;
  extraHeaders?: Record<string, string>;
}

export interface AgentDefaults {
  workspace: string;
  model: string;
  provider: string;
  max_tokens?: number;
  maxTokens?: number;
  temperature: number;
  max_tool_iterations?: number;
  maxToolIterations?: number;
  memory_window?: number;
  memoryWindow?: number;
}

export interface AgentsConfig {
  defaults: AgentDefaults;
}

export interface FeishuConfig {
  enabled: boolean;
  app_id?: string;
  appId?: string;
  app_secret?: string;
  appSecret?: string;
  encrypt_key?: string;
  encryptKey?: string;
  verification_token?: string;
  verificationToken?: string;
  allow_from?: string[];
  allowFrom?: string[];
}

export interface ChannelsConfig {
  send_progress?: boolean;
  sendProgress?: boolean;
  send_tool_hints?: boolean;
  sendToolHints?: boolean;
  feishu: FeishuConfig;
}

export interface WebSearchConfig {
  api_key?: string;
  apiKey?: string;
  max_results?: number;
  maxResults?: number;
}

export interface WebToolsConfig {
  search: WebSearchConfig;
}

export interface ExecToolConfig {
  timeout?: number;
  path_append?: string;
  pathAppend?: string;
}

export interface ToolsConfig {
  web: WebToolsConfig;
  exec: ExecToolConfig;
  restrict_to_workspace?: boolean;
  restrictToWorkspace?: boolean;
}

export interface MCPServerConfigSchema {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  tool_timeout?: number;
  toolTimeout?: number;
}

export interface MCPConfig {
  enabled: boolean;
  servers: Record<string, MCPServerConfigSchema>;
}

export interface Config {
  agents: AgentsConfig;
  channels: ChannelsConfig;
  providers: Record<string, ProviderConfig>;
  tools: ToolsConfig;
  mcp?: MCPConfig;
}

export function createDefaultConfig(): Config {
  return {
    agents: {
      defaults: {
        workspace: '~/.octobot/workspace',
        model: 'anthropic/claude-opus-4-5',
        provider: 'auto',
        max_tokens: 8192,
        temperature: 0.1,
        max_tool_iterations: 40,
        memory_window: 100,
      },
    },
    channels: {
      send_progress: true,
      send_tool_hints: false,
      feishu: {
        enabled: false,
        app_id: '',
        app_secret: '',
        encrypt_key: '',
        verification_token: '',
        allow_from: [],
      },
    },
    providers: {
      custom: { api_key: '' },
      anthropic: { api_key: '' },
      openai: { api_key: '' },
      openrouter: { api_key: '' },
      deepseek: { api_key: '' },
      groq: { api_key: '' },
      zhipu: { api_key: '' },
      dashscope: { api_key: '' },
      vllm: { api_key: '' },
      gemini: { api_key: '' },
      moonshot: { api_key: '' },
      minimax: { api_key: '' },
      aihubmix: { api_key: '' },
      siliconflow: { api_key: '' },
      volcengine: { api_key: '' },
      openai_codex: { api_key: '' },
      github_copilot: { api_key: '' },
    },
    tools: {
      web: {
        search: {
          api_key: '',
          max_results: 5,
        },
      },
      exec: {
        timeout: 60,
        path_append: '',
      },
      restrict_to_workspace: false,
    },
  };
}
