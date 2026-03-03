import * as readline from 'readline';
import { MessageBus, createInboundMessage, OutboundMessage } from '../bus';

// ANSI 颜色代码
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

/**
 * 格式化消息内容（简单的 Markdown 渲染）
 */
function formatContent(content: string): string {
  let formatted = content;

  // 代码块
  formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `${colors.gray}${'─'.repeat(40)}${colors.reset}\n${colors.cyan}${code.trim()}${colors.reset}\n${colors.gray}${'─'.repeat(40)}${colors.reset}`;
  });

  // 行内代码
  formatted = formatted.replace(/`([^`]+)`/g, `${colors.cyan}$1${colors.reset}`);

  // 粗体
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, `${colors.bright}$1${colors.reset}`);

  // 斜体
  formatted = formatted.replace(/\*([^*]+)\*/g, `${colors.dim}$1${colors.reset}`);

  // 标题
  formatted = formatted.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, title) => {
    const color = hashes.length === 1 ? colors.magenta : colors.blue;
    return `${color}${colors.bright}${hashes} ${title}${colors.reset}`;
  });

  // 列表项
  formatted = formatted.replace(/^(\s*)[-*]\s+(.+)$/gm, (_, indent, item) => {
    return `${indent}${colors.yellow}•${colors.reset} ${item}`;
  });

  // 链接
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${colors.blue}$1${colors.reset} ${colors.gray}($2)${colors.reset}`);

  return formatted;
}

export class CLIChannel {
  private running = false;

  constructor(private bus: MessageBus) {}

  async start(): Promise<void> {
    this.running = true;
    console.log(`${colors.cyan}${colors.bright}`);
    console.log('╔════════════════════════════════════╗');
    console.log('║      🐙 octobot - AI Agent         ║');
    console.log('╚════════════════════════════════════╝');
    console.log(`${colors.reset}`);
    console.log(`${colors.gray}✅ CLI channel started${colors.reset}`);
    console.log(`${colors.gray}Type your message (Ctrl+C to exit)${colors.reset}`);
    console.log(`${colors.gray}Commands: /new, /stop, /help${colors.reset}\n`);

    this._startOutboundConsumer();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = () => {
      if (!this.running) {
        rl.close();
        return;
      }

      rl.question(`${colors.green}You:${colors.reset} `, async (input) => {
        const trimmed = input.trim();

        if (trimmed === '/exit' || trimmed === '/quit') {
          this.stop();
          rl.close();
          return;
        }

        if (!trimmed) {
          askQuestion();
          return;
        }

        console.log(`${colors.gray}👤 User default: ${trimmed}${colors.reset}`);

        // 显示思考中
        process.stdout.write(`${colors.gray}octobot is thinking...${colors.reset}`);

        await this.bus.publishInbound(createInboundMessage(
          'cli',
          'user',
          'default',
          trimmed
        ));

        askQuestion();
      });
    };

    askQuestion();
  }

  private async _startOutboundConsumer(): Promise<void> {
    while (this.running) {
      try {
        const msg = await this.bus.consumeOutbound();
        if (msg && msg.channel === 'cli') {
          // 清除 "thinking..." 提示
          process.stdout.write('\r' + ' '.repeat(30) + '\r');

          const formattedContent = formatContent(msg.content);
          console.log(`\n${colors.magenta}${colors.bright}octobot:${colors.reset} ${formattedContent}`);
          console.log(`${colors.gray}✅ Sent response to default${colors.reset}\n`);
        }
      } catch (error) {
        console.error(`${colors.red}Error consuming outbound message:${colors.reset}`, error);
      }
    }
  }

  stop(): void {
    this.running = false;
    console.log(`\n${colors.yellow}👋 Goodbye!${colors.reset}`);
  }

  get isRunning(): boolean {
    return this.running;
  }
}
