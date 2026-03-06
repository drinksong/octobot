import OpenAI from 'openai';
import { jsonrepair } from 'jsonrepair';
import { findByModel, findGateway, findByName, resolveModel, ProviderSpec } from './registry';

// OpenAI SDK 类型
interface OpenAIToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  reasoning_content?: string;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatContent = string | null | ChatContentPart[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: ChatContent;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatResponse {
  content: string | null;
  tool_calls: ToolCall[];
  reasoning_content?: string;
}

export class LLMProvider {
  private client: OpenAI;
  private provider: ProviderSpec | undefined;
  private resolvedModel: string;
  private baseURL: string;
  private providerNameInternal: string;

  constructor(
    private apiKey: string,
    private apiBase: string = '',
    private defaultModel: string = 'gpt-4o-mini',
    private providerName: string = ''
  ) {
    // Detect provider: provider_name (from config) is primary signal
    this.providerNameInternal = this.providerName;
    this.provider = findByName(this.providerNameInternal) || findGateway(this.apiKey, this.apiBase) || findByModel(this.defaultModel);
    
    // Resolve API base
    const baseURL = this.apiBase || this.provider?.defaultApiBase || 'https://api.openai.com/v1';
    this.baseURL = baseURL;
    
    // Create OpenAI client
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: baseURL,
    });

    // Resolve model name
    this.resolvedModel = resolveModel(this.defaultModel, this.apiKey, this.apiBase, this.providerNameInternal);
    
    console.log(`🤖 LLM Provider: ${this.provider?.displayName || 'Custom'}`);
    console.log(`🤖 Model: ${this.resolvedModel}`);
    console.log(`🤖 API Base: ${baseURL}`);
  }

  getSuggestedModels(): string[] {
    const name = this.providerNameInternal || this.provider?.name || '';
    const map: Record<string, string[]> = {
      openai: ['gpt-4o-mini', 'gpt-4o'],
      anthropic: ['claude-3.5-sonnet', 'claude-3-opus'],
      openrouter: ['gpt-4o-mini', 'claude-3.5-sonnet'],
      volcengine: ['ark-code-latest'],
      deepseek: ['deepseek-chat', 'deepseek-reasoner'],
      gemini: ['gemini-1.5-flash', 'gemini-1.5-pro'],
      zhipu: ['glm-4', 'glm-4-flash'],
      dashscope: ['qwen-turbo', 'qwen-plus'],
      moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    };
    const list = map[name] || [];
    if (!name) return list;
    return list.map(m => `${name}/${m}`);
  }

  getCurrentInfo(): { provider: string; model: string; apiBase: string } {
    return {
      provider: this.providerNameInternal || (this.provider?.name || ''),
      model: this.resolvedModel,
      apiBase: this.baseURL,
    };
  }

  setModelAndProvider(model: string, providerName?: string): void {
    if (providerName) {
      this.providerNameInternal = providerName;
      this.provider = findByName(providerName) || findGateway(this.apiKey, this.apiBase) || this.provider;
      const newBase = this.apiBase || this.provider?.defaultApiBase || this.baseURL;
      this.baseURL = newBase;
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: newBase,
      });
    }
    this.resolvedModel = resolveModel(model, this.apiKey, this.apiBase, this.providerNameInternal);
  }

  async chat({
    messages,
    tools = [],
    model,
    temperature = 0.1,
    max_tokens = 8192,
  }: {
    messages: ChatMessage[];
    tools?: any[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<ChatResponse> {
    const finalModel = model ? resolveModel(model, this.apiKey, this.apiBase, this.providerNameInternal) : this.resolvedModel;
    const logPrefix = process.env.MODE === 'cli' ? '\n' : '';
    console.log(`${logPrefix}📤 Sending request to model: ${finalModel}`);

    try {
      const response = await this.client.chat.completions.create({
        model: finalModel,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature,
        max_tokens,
      });
      
      // 检查是否有工具调用的参数被截断
      if (response.choices[0].message.tool_calls) {
        for (const tc of response.choices[0].message.tool_calls) {
          const args = (tc as any).function.arguments;
          if (typeof args === 'string' && args.length > 100) {
            console.log(`📝 Tool call ${(tc as any).function.name} args length: ${args.length}`);
          }
        }
      }

      const choice = response.choices[0];
      const message = choice.message as OpenAIMessage;

      const extractSimpleString = (raw: string, key: string): string | null => {
        const re = new RegExp(`"${key}"\\s*:\\s*"`);
        const match = raw.match(re);
        if (!match || match.index === undefined) return null;
        let i = match.index + match[0].length;
        let out = '';
        let escaped = false;
        while (i < raw.length) {
          const ch = raw[i];
          if (escaped) {
            out += ch;
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            break;
          } else {
            out += ch;
          }
          i++;
        }
        return out;
      };

      const parseToolArgs = (raw: string): Record<string, any> => {
        // 首先尝试标准 JSON 解析
        try {
          return JSON.parse(raw);
        } catch {
          // 然后尝试 jsonrepair（自动修复损坏的 JSON）
          try {
            const repaired = jsonrepair(raw);
            return JSON.parse(repaired);
          } catch (repairError) {
            console.error('❌ JSON repair also failed:', repairError);
            // 最后返回原始字符串作为 _raw 字段
            return { _raw: raw.slice(0, 2000) };
          }
        }
      };

      const tool_calls: ToolCall[] = message.tool_calls?.map((tc) => {
        const args = parseToolArgs(tc.function.arguments);
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        };
      }) || [];

      return {
        content: message.content,
        tool_calls,
        reasoning_content: message.reasoning_content,
      };
    } catch (error: any) {
      console.error('❌ LLM API Error:', error.message);
      return {
        content: `Error calling LLM: ${error.message}`,
        tool_calls: [],
      };
    }
  }
}
