/**
 * 会话类型定义
 * 
 * Session: 存储单个会话的消息历史和元数据
 * SessionMetadata: 会话的元信息（创建时间、更新时间等）
 * SessionMessage: 会话中的单条消息
 */

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  timestamp: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  tools_used?: string[];
}

export interface SessionMetadata {
  _type: 'metadata';
  key: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
  last_consolidated: number;
}

export interface Session {
  key: string;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
  lastConsolidated: number;
}

export interface SessionInfo {
  key: string;
  createdAt: string;
  updatedAt: string;
  path: string;
}

export function createSession(key: string): Session {
  const now = new Date();
  return {
    key,
    messages: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    lastConsolidated: 0,
  };
}

export function addMessage(
  session: Session,
  role: SessionMessage['role'],
  content: string | null,
  options?: Partial<SessionMessage>
): Session {
  const message: SessionMessage = {
    role,
    content,
    timestamp: new Date().toISOString(),
    ...options,
  };
  
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: new Date(),
  };
}

export function getHistory(
  session: Session,
  maxMessages: number = 500
): SessionMessage[] {
  const unconsolidated = session.messages.slice(session.lastConsolidated);
  const sliced = unconsolidated.slice(-maxMessages);

  for (let i = 0; i < sliced.length; i++) {
    if (sliced[i].role === 'user') {
      return sliced.slice(i);
    }
  }

  return sliced;
}

export function clearSession(session: Session): Session {
  return {
    ...session,
    messages: [],
    lastConsolidated: 0,
    updatedAt: new Date(),
  };
}

export function toMetadataLine(session: Session): string {
  const metadata: SessionMetadata = {
    _type: 'metadata',
    key: session.key,
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString(),
    metadata: session.metadata,
    last_consolidated: session.lastConsolidated,
  };
  return JSON.stringify(metadata);
}

export function toMessageLine(message: SessionMessage): string {
  return JSON.stringify({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    ...(message.tool_calls && { tool_calls: message.tool_calls }),
    ...(message.tool_call_id && { tool_call_id: message.tool_call_id }),
    ...(message.name && { name: message.name }),
    ...(message.tools_used && { tools_used: message.tools_used }),
  });
}
