import { Tool, ToolParams } from './base';
import type { WebSearchConfig } from '../../config';

export class WebSearchTool extends Tool {
  constructor(private config: WebSearchConfig = {}) {
    super();
  }

  get name() { return 'web_search'; }
  get description() { return 'Search the web. Returns titles, URLs, and snippets.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Results (1-10)', minimum: 1, maximum: 10 }
      },
      required: ['query']
    };
  }

  async execute({ query, count = 5 }: ToolParams): Promise<string> {
    try {
      const apiKey = this.config.api_key ?? this.config.apiKey;
      if (!apiKey) {
        return 'Error: Tavily api_key not configured. Set tools.web.search.api_key in config.json.';
      }

      const maxFromConfig = this.config.max_results ?? this.config.maxResults;
      const requested = typeof count === 'number' ? count : 5;
      const effectiveCount = Math.max(1, Math.min(10, maxFromConfig ? Math.min(maxFromConfig, requested) : requested));

      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: effectiveCount,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return `Error searching web: ${response.status} ${response.statusText} ${errorText}`.trim();
      }

      const data = await response.json();
      const results = Array.isArray(data.results) ? data.results : [];

      let result = '';
      if (data.answer) {
        result += `✨ Answer:\n${data.answer}\n`;
      }

      if (results.length > 0) {
        result += `${result ? '\n' : ''}🔎 Results:\n`;
        for (const item of results) {
          const title = item.title || item.url || 'Untitled';
          const url = item.url ? `\n  ${item.url}` : '';
          const snippet = item.content ? `\n  ${item.content}` : '';
          result += `- ${title}${url}${snippet}\n`;
        }
      }

      return result || 'No results found. Try a different query.';
    } catch (e: any) {
      return `Error searching web: ${e.message}`;
    }
  }
}
