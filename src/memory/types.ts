/**
 * 记忆系统类型定义
 *
 * 双层记忆架构：
 * 1. MEMORY.md - 长期事实记忆（用户偏好、项目信息）
 * 2. HISTORY.md - 可搜索历史（按时间线记录的事件）
 */

export interface MemoryConsolidationResult {
  /** 历史条目（2-5 句话总结，用于 grep 搜索） */
  historyEntry: string;
  /** 更新的长期记忆（完整的 MEMORY.md 内容） */
  memoryUpdate: string;
}

export interface MemoryStore {
  /** 长期记忆文件路径 */
  memoryFile: string;
  /** 历史记录文件路径 */
  historyFile: string;
}

export interface ConsolidationOptions {
  /** 是否归档所有消息（默认只归档旧消息） */
  archiveAll?: boolean;
  /** 保留的消息数量（默认保留一半） */
  keepCount?: number;
  /** 触发整合的阈值 */
  threshold?: number;
}

/** 用于记忆整合的工具定义 */
export const SAVE_MEMORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'save_memory',
    description:
      'Save the memory consolidation result to persistent storage. ' +
      'Extract long-term facts and summarize events from the conversation.',
    parameters: {
      type: 'object',
      properties: {
        history_entry: {
          type: 'string',
          description:
            'A paragraph (2-5 sentences) summarizing key events/decisions/topics. ' +
            'Start with [YYYY-MM-DD HH:MM]. Include detail useful for grep search.',
        },
        memory_update: {
          type: 'string',
          description:
            'Full updated long-term memory as markdown. Include all existing ' +
            'facts plus new ones. Return unchanged if nothing new.',
        },
      },
      required: ['history_entry', 'memory_update'],
    },
  },
};

/** 默认的 MEMORY.md 模板 */
export const DEFAULT_MEMORY_TEMPLATE = `# Long-term Memory

This file contains important facts about the user and project.
Edit this file directly to add or update information.

## User Preferences

- (Add preferences here)

## Project Context

- (Add project information here)

## People & Relationships

- (Add relationships here)
`;

/** 默认的 HISTORY.md 模板 */
export const DEFAULT_HISTORY_TEMPLATE = `# Conversation History

This file contains a chronological log of important events and decisions.
Search it with: grep -i "keyword" memory/HISTORY.md

`;
