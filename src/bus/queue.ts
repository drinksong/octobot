/**
 * 消息总线 - 异步消息队列实现
 * 
 * 解耦通道（Channel）和 Agent 核心处理逻辑
 * 通道将消息推送到入站队列，Agent 处理后将响应推送到出站队列
 */

import { InboundMessage, OutboundMessage } from './events';

export class MessageBus {
  private inboundQueue: InboundMessage[] = [];
  private outboundQueue: OutboundMessage[] = [];
  private inboundResolvers: Array<(value: InboundMessage) => void> = [];
  private outboundResolvers: Array<(value: OutboundMessage) => void> = [];

  async publishInbound(msg: InboundMessage): Promise<void> {
    if (this.inboundResolvers.length > 0) {
      const resolver = this.inboundResolvers.shift()!;
      resolver(msg);
    } else {
      this.inboundQueue.push(msg);
    }
  }

  async consumeInbound(): Promise<InboundMessage> {
    if (this.inboundQueue.length > 0) {
      return this.inboundQueue.shift()!;
    }
    return new Promise<InboundMessage>((resolve) => {
      this.inboundResolvers.push(resolve);
    });
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    if (this.outboundResolvers.length > 0) {
      const resolver = this.outboundResolvers.shift()!;
      resolver(msg);
    } else {
      this.outboundQueue.push(msg);
    }
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    if (this.outboundQueue.length > 0) {
      return this.outboundQueue.shift()!;
    }
    return new Promise<OutboundMessage>((resolve) => {
      this.outboundResolvers.push(resolve);
    });
  }

  get inboundSize(): number {
    return this.inboundQueue.length;
  }

  get outboundSize(): number {
    return this.outboundQueue.length;
  }

  clear(): void {
    this.inboundQueue = [];
    this.outboundQueue = [];
    this.inboundResolvers = [];
    this.outboundResolvers = [];
  }
}
