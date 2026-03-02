/**
 * 消息事件类型定义
 * 
 * InboundMessage: 从通道发往 Agent 的消息
 * OutboundMessage: 从 Agent 发往通道的消息
 */

export interface InboundMessage {
  readonly channel: string;
  readonly senderId: string;
  readonly chatId: string;
  readonly content: string;
  readonly media: string[];
  readonly metadata: Record<string, any>;
  readonly sessionKeyOverride?: string;
  readonly sessionKey: string;
}

export interface OutboundMessage {
  readonly channel: string;
  readonly chatId: string;
  readonly content: string;
  readonly metadata: Record<string, any>;
}

export class InboundMessageImpl implements InboundMessage {
  constructor(
    public readonly channel: string,
    public readonly senderId: string,
    public readonly chatId: string,
    public readonly content: string,
    public readonly media: string[] = [],
    public readonly metadata: Record<string, any> = {},
    public readonly sessionKeyOverride?: string
  ) {}

  get sessionKey(): string {
    return this.sessionKeyOverride || `${this.channel}:${this.chatId}`;
  }
}

export class OutboundMessageImpl implements OutboundMessage {
  constructor(
    public readonly channel: string,
    public readonly chatId: string,
    public readonly content: string,
    public readonly metadata: Record<string, any> = {}
  ) {}
}

export function createInboundMessage(
  channel: string,
  senderId: string,
  chatId: string,
  content: string,
  options?: {
    media?: string[];
    metadata?: Record<string, any>;
    sessionKeyOverride?: string;
  }
): InboundMessage {
  return new InboundMessageImpl(
    channel,
    senderId,
    chatId,
    content,
    options?.media || [],
    options?.metadata || {},
    options?.sessionKeyOverride
  );
}

export function createOutboundMessage(
  channel: string,
  chatId: string,
  content: string,
  metadata?: Record<string, any>
): OutboundMessage {
  return new OutboundMessageImpl(channel, chatId, content, metadata);
}
