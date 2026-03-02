/**
 * 会话管理器
 * 
 * 负责会话的创建、加载、保存和管理
 * 使用 JSONL 格式存储会话数据
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  Session,
  SessionInfo,
  SessionMessage,
  SessionMetadata,
  createSession,
  toMetadataLine,
  toMessageLine,
} from './types';

export class SessionManager {
  private sessionsDir: string;
  private cache: Map<string, Session> = new Map();

  constructor(workspace: string) {
    const expandedWorkspace = this.expandPath(workspace);
    this.sessionsDir = path.join(expandedWorkspace, 'sessions');
  }

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating sessions directory:', error);
    }
  }

  private safeFilename(key: string): string {
    return key.replace(/[<>:"/\\|?*]/g, '_');
  }

  private getSessionPath(key: string): string {
    const safeKey = this.safeFilename(key.replace(':', '_'));
    return path.join(this.sessionsDir, `${safeKey}.jsonl`);
  }

  async getOrCreate(key: string): Promise<Session> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const session = await this.load(key);
    if (session) {
      this.cache.set(key, session);
      return session;
    }

    const newSession = createSession(key);
    this.cache.set(key, newSession);
    return newSession;
  }

  private async load(key: string): Promise<Session | null> {
    const sessionPath = this.getSessionPath(key);

    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      const lines = content.trim().split('\n');

      let metadata: SessionMetadata | null = null;
      const messages: SessionMessage[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        const data = JSON.parse(line);

        if (data._type === 'metadata') {
          metadata = data as SessionMetadata;
        } else {
          messages.push(data as SessionMessage);
        }
      }

      if (!metadata) {
        return null;
      }

      return {
        key: metadata.key,
        messages,
        createdAt: new Date(metadata.created_at),
        updatedAt: new Date(metadata.updated_at),
        metadata: metadata.metadata,
        lastConsolidated: metadata.last_consolidated,
      };
    } catch (error) {
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    await this.ensureDir();

    const sessionPath = this.getSessionPath(session.key);
    const lines: string[] = [];

    lines.push(toMetadataLine(session));
    for (const msg of session.messages) {
      lines.push(toMessageLine(msg));
    }

    await fs.writeFile(sessionPath, lines.join('\n') + '\n', 'utf-8');
    this.cache.set(session.key, session);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  async listSessions(): Promise<SessionInfo[]> {
    await this.ensureDir();

    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessions: SessionInfo[] = [];

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const filePath = path.join(this.sessionsDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const firstLine = content.split('\n')[0];

          if (firstLine) {
            const data = JSON.parse(firstLine);
            if (data._type === 'metadata') {
              sessions.push({
                key: data.key || file.replace('.jsonl', '').replace('_', ':'),
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                path: filePath,
              });
            }
          }
        } catch (error) {
          continue;
        }
      }

      return sessions.sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch (error) {
      return [];
    }
  }

  async delete(key: string): Promise<boolean> {
    const sessionPath = this.getSessionPath(key);
    this.cache.delete(key);

    try {
      await fs.unlink(sessionPath);
      return true;
    } catch (error) {
      return false;
    }
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
