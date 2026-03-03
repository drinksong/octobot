# mini-nanobot (octobot) 🐙

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 一个模块化的 AI Agent 框架，专注多通道交互、会话与记忆管理、技能扩展与工具编排，灵感来自 [nanobot](https://github.com/danielmiessler/nanobot) 🐈。

mini-nanobot（octobot）以 TypeScript 实现，提供可扩展的工具系统、双层记忆架构、技能加载机制与 MCP 集成，适用于构建面向研发流程的智能助手与自动化工作流。

## ✨ 特性

- 🤖 **多 LLM 支持**：OpenAI、Anthropic、VolcEngine、DeepSeek、Gemini、智谱、Moonshot 等
- 💬 **多通道交互**：CLI 与飞书机器人（WebSocket）
- 🧠 **双层记忆**：MEMORY.md（长期事实）+ HISTORY.md（可搜索日志）
- 📦 **技能系统**：SKILL.md 描述能力与依赖，按需加载
- 🔗 **MCP 集成**：连接 Model Context Protocol 服务器扩展工具
- 🚌 **消息总线**：生产者-消费者模型解耦通道与核心循环
- 🛠️ **工具体系**：文件、执行、搜索、抓取、子代理、定时任务
- 💾 **会话持久化**：JSONL 存储，支持多会话并发

## 🚀 快速开始

### 安装

```bash
git clone https://github.com/yourusername/octobot.git
cd octobot
npm install
```

### 配置

配置文件路径：`~/.octobot/config.json`

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.octobot/workspace",
      "model": "ark-code-latest",
      "provider": "volcengine",
      "max_tokens": 8192,
      "temperature": 0.1,
      "max_tool_iterations": 40,
      "memory_window": 100
    }
  },
  "providers": {
    "volcengine": {
      "api_key": "YOUR_API_KEY",
      "api_base": "https://ark.cn-beijing.volces.com/api/coding/v3"
    }
  },
  "tools": {
    "web": {
      "search": {
        "api_key": "TAVILY_API_KEY",
        "max_results": 5
      }
    },
    "exec": {
      "timeout": 60,
      "path_append": ""
    },
    "restrict_to_workspace": false
  },
  "channels": {
    "feishu": {
      "enabled": false,
      "app_id": "",
      "app_secret": ""
    }
  }
}
```

### 运行

```bash
# CLI 模式
MODE=cli npm start

# 飞书机器人模式
MODE=feishu npm start
```

## 📖 使用指南

### CLI

```text
› 你好
octobot: 你好！有什么需要我协助的吗？
```

### 飞书

1. 在飞书开放平台创建机器人
2. 配置 `channels.feishu.app_id/app_secret`
3. 运行 `MODE=feishu npm start`
4. 在飞书中 @ 机器人开始对话

## 🧩 工具与技能

### 内置工具

| 工具 | 描述 |
|------|------|
| `read_file` | 读取文件内容 |
| `write_file` | 写入文件 |
| `edit_file` | 编辑文件 |
| `list_dir` | 列出目录 |
| `exec` | 执行命令（安全校验与超时控制） |
| `web_search` | 网络搜索（Tavily） |
| `web_fetch` | 网页抓取并抽取可读内容 |
| `message` | 发送消息 |
| `spawn` | 子代理任务 |
| `cron` | 定时任务 |

### 技能结构

技能目录：`{workspace}/skills/<skill>/SKILL.md`

```markdown
---
name: tmux
description: Control tmux sessions
always: false
metadata: {"octobot": {"requires": {"bins": ["tmux"]}}}
---

# tmux Skill
Use tmux to manage terminal sessions...
```

## 🏗️ 架构概览

- **Channels**：CLI / Feishu
- **Core**：AgentLoop + MessageBus
- **Managers**：Session / Memory / Skills
- **Infra**：LLM Provider / Tools / Config

## 🔧 MCP 扩展

```json
{
  "mcp": {
    "enabled": true,
    "servers": {
      "sqlite": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sqlite", "./data.db"]
      }
    }
  }
}
```

可用 MCP 服务器：https://github.com/modelcontextprotocol/servers

## 🤝 贡献

欢迎提交 Issue / PR。请确保：

1. 通过 TypeScript 类型检查：`npx tsc --noEmit`
2. 遵循既有代码风格
3. 更新相关文档

## 📄 许可证

[MIT](LICENSE)

## 🙏 致谢

- 灵感来源：[nanobot](https://github.com/danielmiessler/nanobot) 🐈
- 飞书 SDK：[@larksuiteoapi/node-sdk](https://github.com/larksuite/node-sdk)
