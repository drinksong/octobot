/**
 * Web Fetch 工具
 *
 * 获取网页内容并提取可读文本，支持 HTML 转 Markdown。
 * 参考: nanobot/agent/tools/web.py
 */

import axios from 'axios';
import { Tool, ToolParams } from './base';

// 用户代理
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36';

// 最大字符数
const MAX_CHARS = 50000;

/**
 * 移除 HTML 标签
 */
function stripTags(html: string): string {
  // 移除 script 和 style
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // 移除其他标签
  text = text.replace(/<[^>]+>/g, '');
  // 解码 HTML 实体
  text = text.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return text.trim();
}

/**
 * 规范化空白字符
 */
function normalize(text: string): string {
  text = text.replace(/[ \t]+/g, ' ');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 简单的 HTML 转 Markdown
 */
function toMarkdown(html: string): string {
  // 转换链接
  let text = html.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, content) => `[${stripTags(content)}](${href})`);

  // 转换标题
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level, content) => `\n${'#'.repeat(parseInt(level))} ${stripTags(content)}\n`);

  // 转换列表
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, content) => `\n- ${stripTags(content)}`);

  // 转换段落
  text = text.replace(/<\/(p|div|section|article)>/gi, '\n\n');

  // 转换换行
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n');

  return normalize(stripTags(text));
}

/**
 * 提取标题
 */
function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]).trim() : null;
}

/**
 * Web Fetch 工具
 *
 * 获取 URL 内容并提取可读文本
 */
export class WebFetchTool extends Tool {
  private maxChars: number;

  constructor(maxChars: number = MAX_CHARS) {
    super();
    this.maxChars = maxChars;
  }

  get name(): string {
    return 'web_fetch';
  }

  get description(): string {
    return 'Fetch URL and extract readable content (HTML → markdown/text). Returns structured data with title, text content, and metadata.';
  }

  get parameters(): { type: string; properties: Record<string, any>; required?: string[] } {
    return {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch'
        },
        extractMode: {
          type: 'string',
          enum: ['markdown', 'text'],
          default: 'markdown',
          description: 'Extract mode: markdown or plain text'
        },
        maxChars: {
          type: 'integer',
          minimum: 100,
          description: 'Maximum characters to return'
        }
      },
      required: ['url']
    };
  }

  async execute(params: ToolParams): Promise<string> {
    const { url, extractMode = 'markdown', maxChars } = params;
    const limit = maxChars || this.maxChars;

    // 验证 URL
    if (!url || typeof url !== 'string') {
      return JSON.stringify({ error: 'URL is required', url });
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return JSON.stringify({ error: 'Only http/https URLs are allowed', url });
      }
    } catch {
      return JSON.stringify({ error: 'Invalid URL format', url });
    }

    try {
      console.log(`[WebFetch] Fetching: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 30000,
        maxRedirects: 5,
        responseType: 'text'
      });

      const contentType = response.headers['content-type'] || '';
      const html = response.data;

      let text: string;
      let extractor: string;

      if (contentType.includes('application/json')) {
        // JSON 内容
        text = JSON.stringify(response.data, null, 2);
        extractor = 'json';
      } else if (contentType.includes('text/html') || html.trim().toLowerCase().startsWith('<!doctype') || html.trim().toLowerCase().startsWith('<html')) {
        // HTML 内容
        const title = extractTitle(html);
        const content = extractMode === 'markdown' ? toMarkdown(html) : normalize(stripTags(html));
        text = title ? `# ${title}\n\n${content}` : content;
        extractor = 'readability';
      } else {
        // 纯文本或其他
        text = html;
        extractor = 'raw';
      }

      // 截断
      const truncated = text.length > limit;
      if (truncated) {
        text = text.substring(0, limit) + '\n\n[Content truncated...]';
      }

      const result = {
        url,
        finalUrl: response.request.res.responseUrl || url,
        status: response.status,
        extractor,
        truncated,
        length: text.length,
        text
      };

      return JSON.stringify(result, null, 2);

    } catch (error: any) {
      console.error(`[WebFetch] Error fetching ${url}:`, error.message);

      return JSON.stringify({
        error: error.message,
        url,
        status: error.response?.status || 0
      });
    }
  }
}
