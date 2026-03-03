import * as fs from 'fs/promises';
import { existsSync, lstatSync } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { Tool, ToolParams } from './base';

export class ReadFileTool extends Tool {
  constructor(private workspace: string = process.cwd()) {
    super();
  }

  get name() { return 'read_file'; }
  get description() { return 'Read the contents of a file at the given path.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to read' }
      },
      required: ['path']
    };
  }

  async execute({ path: filePath }: ToolParams): Promise<string> {
    try {
      const resolvedPath = path.resolve(this.workspace, filePath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return content;
    } catch (e) {
      return `Error reading file: ${e}`;
    }
  }
}

export class WriteFileTool extends Tool {
  constructor(private workspace: string = process.cwd()) {
    super();
  }

  get name() { return 'write_file'; }
  get description() { return 'Write content to a file at the given path.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to write to' },
        content: { type: 'string', description: 'The content to write' }
      },
      required: ['path', 'content']
    };
  }

  async execute({ path: filePath, content }: ToolParams): Promise<string> {
    try {
      const resolvedPath = path.resolve(this.workspace, filePath);
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolvedPath, content, 'utf-8');
      return `Successfully wrote ${content.length} bytes to ${resolvedPath}`;
    } catch (e) {
      return `Error writing file: ${e}`;
    }
  }
}

export class EditFileTool extends Tool {
  constructor(private workspace: string = process.cwd()) {
    super();
  }

  get name() { return 'edit_file'; }
  get description() { return 'Edit a file by replacing old_text with new_text. The old_text must exist exactly in the file.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to edit' },
        old_text: { type: 'string', description: 'The exact text to find and replace' },
        new_text: { type: 'string', description: 'The text to replace with' }
      },
      required: ['path', 'old_text', 'new_text']
    };
  }

  async execute({ path: filePath, old_text, new_text }: ToolParams): Promise<string> {
    try {
      const resolvedPath = path.resolve(this.workspace, filePath);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      
      if (!content.includes(old_text)) {
        return `Error: old_text not found in file. The exact text must exist to perform replacement.`;
      }
      
      const newContent = content.replace(old_text, new_text);
      await fs.writeFile(resolvedPath, newContent, 'utf-8');
      
      return `Successfully replaced text in ${resolvedPath}`;
    } catch (e) {
      return `Error editing file: ${e}`;
    }
  }
}

export class ListDirTool extends Tool {
  constructor(private workspace: string = process.cwd()) {
    super();
  }

  get name() { return 'list_dir'; }
  get description() { return 'List the contents of a directory.'; }
  get parameters() {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to list' }
      },
      required: ['path']
    };
  }

  async execute({ path: dirPath }: ToolParams): Promise<string> {
    try {
      const resolvedPath = path.resolve(this.workspace, dirPath);
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      
      const result = entries.map(entry => {
        const type = entry.isDirectory() ? '[DIR]' : '[FILE]';
        return `${type} ${entry.name}`;
      }).join('\n');
      
      return result || '(empty directory)';
    } catch (e) {
      return `Error listing directory: ${e}`;
    }
  }
}

export class ExecTool extends Tool {
  private denyPatterns: RegExp[] = [
    /\brm\s+-[rf]{1,2}\b/,          // rm -r, rm -rf, rm -fr
    /\bdel\s+\/[fq]\b/,             // del /f, del /q
    /\brmdir\s+\/s\b/,              // rmdir /s
    /(?:^|[;&|]\s*)format\b/,       // format (作为独立命令)
    /\b(mkfs|diskpart)\b/,          // 磁盘操作
    /\bdd\s+if=/,                   // dd
    />\s*\/dev\/sd/,                // 写入磁盘
    /\b(shutdown|reboot|poweroff)\b/, // 系统关机/重启
    /:\(\)\s*\{.*\};\s*:/,          // fork bomb
  ];

  private allowPatterns: RegExp[];
  private restrictToWorkspace: boolean;
  private timeoutSeconds: number;
  private pathAppend: string;
  private workingDir: string | undefined;

  constructor(
    private workspace: string = process.cwd(),
    options: {
      timeout?: number;
      allowPatterns?: RegExp[];
      restrictToWorkspace?: boolean;
      pathAppend?: string;
      workingDir?: string;
    } = {}
  ) {
    super();
    this.timeoutSeconds = options.timeout ?? 60;
    this.allowPatterns = options.allowPatterns ?? [];
    this.restrictToWorkspace = options.restrictToWorkspace ?? false;
    this.pathAppend = options.pathAppend ?? '';
    this.workingDir = options.workingDir;
  }

  get name() { return 'exec'; }
  get description() { 
    return 'Execute a shell command and return its output. Use with caution.'; 
  }
  get parameters() {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        working_dir: { type: 'string', description: 'Optional working directory for the command' }
      },
      required: ['command']
    };
  }

  async execute({ command, working_dir }: ToolParams): Promise<string> {
    const requestedCwd = working_dir || this.workingDir;
    const cwdForGuard = requestedCwd
      ? path.resolve(this.workspace, requestedCwd)
      : process.cwd();
    const guardError = this._guardCommand(command, cwdForGuard);
    if (guardError) {
      return guardError;
    }

    const env = { ...process.env };
    if (this.pathAppend) {
      env.PATH = (env.PATH || '') + path.delimiter + this.pathAppend;
    }

    return await new Promise<string>((resolve) => {
      const shellPath = process.env.SHELL && process.env.SHELL.trim()
        ? process.env.SHELL
        : (existsSync('/bin/sh') ? '/bin/sh' : '/bin/bash');
      const spawnOptions: { env: NodeJS.ProcessEnv; shell: string | boolean; cwd?: string } = {
        env,
        shell: shellPath,
      };
      if (requestedCwd) {
        const resolvedCwd = path.resolve(this.workspace, requestedCwd);
        try {
          if (existsSync(resolvedCwd) && lstatSync(resolvedCwd).isDirectory()) {
            spawnOptions.cwd = resolvedCwd;
          }
        } catch {}
      }
      const child = spawn(command, spawnOptions);
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let resolved = false;
      let timedOut = false;

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, this.timeoutSeconds * 1000);

      const finalize = (result: string) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(killTimer);
        resolve(result);
      };

      child.stdout?.on('data', (chunk) => {
        stdoutChunks.push(Buffer.from(chunk));
      });

      child.stderr?.on('data', (chunk) => {
        stderrChunks.push(Buffer.from(chunk));
      });

      child.on('error', (err) => {
        finalize(`Error executing command: ${err.message}`);
      });

      child.on('close', (code) => {
        if (timedOut) {
          finalize(`Error: Command timed out after ${this.timeoutSeconds} seconds`);
          return;
        }

        const stdoutText = stdoutChunks.length > 0
          ? Buffer.concat(stdoutChunks).toString('utf-8')
          : '';
        const stderrText = stderrChunks.length > 0
          ? Buffer.concat(stderrChunks).toString('utf-8')
          : '';

        const outputParts: string[] = [];
        if (stdoutText) {
          outputParts.push(stdoutText);
        }
        if (stderrText && stderrText.trim()) {
          outputParts.push(`STDERR:\n${stderrText}`);
        }
        const exitCode = typeof code === 'number' ? code : 0;
        if (exitCode !== 0) {
          outputParts.push(`\nExit code: ${exitCode}`);
        }

        let result = outputParts.length > 0 ? outputParts.join('\n') : '(no output)';
        const maxLen = 10000;
        if (result.length > maxLen) {
          result = result.substring(0, maxLen) +
            `\n... (truncated, ${result.length - maxLen} more chars)`;
        }

        finalize(result);
      });
    });
  }

  /**
   * 命令安全检查
   */
  private _guardCommand(command: string, cwd: string): string | null {
    const cmd = command.trim();
    const lower = cmd.toLowerCase();

    for (const pattern of this.denyPatterns) {
      if (pattern.test(lower)) {
        return 'Error: Command blocked by safety guard (dangerous pattern detected)';
      }
    }

    if (this.allowPatterns.length > 0) {
      const allowed = this.allowPatterns.some(p => p.test(lower));
      if (!allowed) {
        return 'Error: Command blocked by safety guard (not in allowlist)';
      }
    }

    if (this.restrictToWorkspace) {
      if (cmd.includes('..\\') || cmd.includes('../')) {
        return 'Error: Command blocked by safety guard (path traversal detected)';
      }

      const cwdResolved = path.resolve(cwd);
      for (const raw of this._extractAbsolutePaths(cmd)) {
        try {
          const resolved = path.resolve(raw.trim());
          if (path.isAbsolute(resolved) && !this._isWithinCwd(resolved, cwdResolved)) {
            return 'Error: Command blocked by safety guard (path outside working dir)';
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  private _extractAbsolutePaths(command: string): string[] {
    const winPaths = command.match(/[A-Za-z]:\\[^\s"'|><;]+/g) ?? [];
    const posixPaths = Array.from(
      command.matchAll(/(?:^|[\s|>])(\/[^\s"'>]+)/g),
      match => match[1]
    );
    return [...winPaths, ...posixPaths];
  }

  private _isWithinCwd(targetPath: string, cwdResolved: string): boolean {
    const relative = path.relative(cwdResolved, targetPath);
    if (relative === '') return true;
    if (path.isAbsolute(relative)) return false;
    return !relative.startsWith('..');
  }
}
