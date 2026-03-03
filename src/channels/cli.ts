import * as readline from 'readline';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { MessageBus, createInboundMessage, OutboundMessage } from '../bus';

/**
 * 格式化消息内容（简单的 Markdown 渲染）
 */
function formatContent(content: string): string {
  let formatted = content;

  // 代码块
  formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return `${chalk.gray('─'.repeat(40))}\n${chalk.cyan(code.trim())}\n${chalk.gray('─'.repeat(40))}`;
  });

  // 行内代码
  formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code));

  // 粗体
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, text) => chalk.bold(text));

  // 斜体
  formatted = formatted.replace(/\*([^*]+)\*/g, (_, text) => chalk.dim(text));

  // 标题
  formatted = formatted.replace(/^(#{1,6})\s+(.+)$/gm, (_, hashes, title) => {
    return hashes.length === 1
      ? chalk.magenta.bold(`${hashes} ${title}`)
      : chalk.blue.bold(`${hashes} ${title}`);
  });

  // 列表项
  formatted = formatted.replace(/^(\s*)[-*]\s+(.+)$/gm, (_, indent, item) => {
    return `${indent}${chalk.yellow('•')} ${item}`;
  });

  // 链接
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    return `${chalk.blue(text)} ${chalk.gray(`(${url})`)}`;
  });

  return formatted;
}

export class CLIChannel {
  private running = false;
  private spinner: Ora | null = null;
  private rl: readline.Interface | null = null;

  constructor(private bus: MessageBus) {}

  async start(): Promise<void> {
    this.running = true;
    console.log(chalk.cyan.bold('╔════════════════════════════════════╗'));
    console.log(chalk.cyan.bold('║      🐙 octobot - AI Agent         ║'));
    console.log(chalk.cyan.bold('╚════════════════════════════════════╝'));
    console.log(chalk.gray('✅ CLI channel started'));
    console.log(chalk.gray('Type your message (Ctrl+C to exit)'));
    console.log(chalk.gray('Commands: /new, /stop, /help') + '\n');

    const outboundTask = this._startOutboundConsumer();

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    this.rl.setPrompt(chalk.green('You: '));

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();

      if (trimmed === '/exit' || trimmed === '/quit') {
        this.stop();
        this.rl?.close();
        return;
      }

      if (!trimmed) {
        this._resumeInput();
        return;
      }

      this._startThinking();
      this._pauseInput();

      await this.bus.publishInbound(createInboundMessage(
        'cli',
        'user',
        'default',
        trimmed
      ));
    });

    const done = new Promise<void>((resolve) => {
      this.rl?.on('close', () => {
        this.running = false;
        this._stopThinking();
        this.rl = null;
        resolve();
      });
    });
    process.on('SIGINT', () => {
      if (this.running) {
        this.rl?.close();
      }
    });
    this._resumeInput();
    await Promise.race([done, outboundTask]);
  }

  private async _startOutboundConsumer(): Promise<void> {
    while (this.running) {
      try {
        const msg = await this.bus.consumeOutbound();
        if (msg && msg.channel === 'cli') {
          if (msg.metadata?.kind === 'tool_call') {
            this._stopThinking();
            console.log(chalk.gray(`\n${msg.content}\n`));
            this._startThinking();
            continue;
          }
          this._stopThinking();

          const formattedContent = formatContent(msg.content);
          console.log(`\n${chalk.magenta.bold('octobot:')} ${formattedContent}\n`);
          this._resumeInput();
        }
      } catch (error) {
        this._stopThinking();
        console.error(chalk.red('Error consuming outbound message:'), error);
        this._resumeInput();
      }
    }
  }

  stop(): void {
    this.running = false;
    this._stopThinking();
    console.log(`\n${chalk.yellow('👋 Goodbye!')}`);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private _startThinking(): void {
    if (this.spinner) {
      this.spinner.stop();
    }
    this.spinner = ora({
      text: 'octobot is thinking...',
      spinner: 'dots',
      color: 'cyan',
      discardStdin: false,
      stream: process.stderr,
    });
    this.spinner.start();
  }

  private _stopThinking(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
    this._clearLine();
  }

  private _pauseInput(): void {
    if (this.rl) {
      this.rl.pause();
    }
  }

  private _resumeInput(): void {
    if (this.rl && this.running) {
      this.rl.resume();
      this.rl.prompt();
    }
  }

  private _clearLine(): void {
    if (process.stdout.isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
  }
}
