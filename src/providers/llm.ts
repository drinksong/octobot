import OpenAI from 'openai';
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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
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

  constructor(
    private apiKey: string,
    private apiBase: string = '',
    private defaultModel: string = 'gpt-4o-mini',
    private providerName: string = ''
  ) {
    // Detect provider: provider_name (from config) is primary signal
    this.provider = findByName(this.providerName) || findGateway(this.apiKey, this.apiBase) || findByModel(this.defaultModel);
    
    // Resolve API base
    const baseURL = this.apiBase || this.provider?.defaultApiBase || 'https://api.openai.com/v1';
    
    // Create OpenAI client
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: baseURL,
    });

    // Resolve model name
    this.resolvedModel = resolveModel(this.defaultModel, this.apiKey, this.apiBase, this.providerName);
    
    console.log(`🤖 LLM Provider: ${this.provider?.displayName || 'Custom'}`);
    console.log(`🤖 Model: ${this.resolvedModel}`);
    console.log(`🤖 API Base: ${baseURL}`);
  }

  async chat({
    messages,
    tools = [],
    model,
    temperature = 0.1,
    max_tokens = 512,
  }: {
    messages: ChatMessage[];
    tools?: any[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<ChatResponse> {
    const finalModel = model ? resolveModel(model, this.apiKey, this.apiBase) : this.resolvedModel;
    
    console.log(`📤 Sending request to model: ${finalModel}`);

    try {
      const response = await this.client.chat.completions.create({
        model: finalModel,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        temperature,
        max_tokens,
      });

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

      const extractTrailingString = (raw: string, key: string): string | null => {
        const re = new RegExp(`"${key}"\\s*:\\s*"`);
        const match = raw.match(re);
        if (!match || match.index === undefined) return null;
        const start = match.index + match[0].length;
        const lastQuote = raw.lastIndexOf('"');
        if (lastQuote <= start) return null;
        return raw.slice(start, lastQuote);
      };

      const parseToolArgs = (raw: string): Record<string, any> => {
        try {
          return JSON.parse(raw);
        } catch {
          const args: Record<string, any> = {};
          const path = extractSimpleString(raw, 'path');
          const command = extractSimpleString(raw, 'command');
          const workingDir = extractSimpleString(raw, 'working_dir');
          const content = extractTrailingString(raw, 'content');
          if (path) args.path = path;
          if (command) args.command = command;
          if (workingDir) args.working_dir = workingDir;
          if (content) {
            args.content = content
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t')
              .replace(/\\"/g, '"');
          }
          if (Object.keys(args).length === 0) {
            args._raw = raw.slice(0, 2000);
          }
          return args;
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
