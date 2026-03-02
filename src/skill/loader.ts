/**
 * 技能加载器
 *
 * 负责：
 * 1. 从内置目录和工作区目录加载技能
 * 2. 解析 YAML frontmatter
 * 3. 检查依赖要求
 * 4. 提取技能内容
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  Skill,
  SkillInfo,
  SkillMetadata,
  NanobotMetadata,
  SkillLoadOptions,
  DEFAULT_SKILL_METADATA,
  BUILTIN_SKILLS_DIR,
} from './types';

export class SkillLoader {
  private workspaceSkillsDir: string;
  private builtinSkillsDir: string;

  constructor(workspace: string, builtinDir?: string) {
    const expandedWorkspace = this.expandPath(workspace);
    this.workspaceSkillsDir = path.join(expandedWorkspace, 'skills');
    // 内置技能目录：优先使用传入的路径，否则使用相对于项目根目录的路径
    this.builtinSkillsDir = builtinDir || path.join(process.cwd(), BUILTIN_SKILLS_DIR);
  }

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  /**
   * 列出所有可用技能
   */
  async listSkills(options: SkillLoadOptions = {}): Promise<SkillInfo[]> {
    const { filterUnavailable = true } = options;
    const skills: SkillInfo[] = [];

    // 1. 加载工作区技能（优先级最高）
    try {
      const workspaceSkills = await this._loadFromDir(
        this.workspaceSkillsDir,
        'workspace'
      );
      skills.push(...workspaceSkills);
    } catch (error) {
      // 目录可能不存在
    }

    // 2. 加载内置技能（排除已存在的工作区技能）
    try {
      const builtinSkills = await this._loadFromDir(
        this.builtinSkillsDir,
        'builtin'
      );
      for (const skill of builtinSkills) {
        if (!skills.some((s) => s.name === skill.name)) {
          skills.push(skill);
        }
      }
    } catch (error) {
      // 目录可能不存在
    }

    // 3. 过滤不可用的技能
    if (filterUnavailable) {
      return skills.filter((s) => s.available);
    }

    return skills;
  }

  /**
   * 从目录加载技能
   */
  private async _loadFromDir(
    dir: string,
    source: 'builtin' | 'workspace'
  ): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFile = path.join(dir, entry.name, 'SKILL.md');
        try {
          const content = await fs.readFile(skillFile, 'utf-8');
          const meta = this._parseFrontmatter(content);
          const octobotMeta = this._parseNanobotMetadata(meta.metadata);
          const available = this._checkRequirements(octobotMeta);

          skills.push({
            name: meta.name || entry.name,
            path: skillFile,
            source,
            available,
            meta: { ...meta, name: meta.name || entry.name },
            octobotMeta,
          });
        } catch (error) {
          // 文件不存在或解析失败，跳过
        }
      }
    } catch (error) {
      // 目录不存在
    }

    return skills;
  }

  /**
   * 加载特定技能
   */
  async loadSkill(name: string): Promise<Skill | null> {
    // 1. 先检查工作区
    const workspacePath = path.join(this.workspaceSkillsDir, name, 'SKILL.md');
    try {
      const content = await fs.readFile(workspacePath, 'utf-8');
      return this._createSkill(content, workspacePath, 'workspace');
    } catch {
      // 工作区不存在，继续检查内置
    }

    // 2. 检查内置
    const builtinPath = path.join(this.builtinSkillsDir, name, 'SKILL.md');
    try {
      const content = await fs.readFile(builtinPath, 'utf-8');
      return this._createSkill(content, builtinPath, 'builtin');
    } catch {
      // 不存在
    }

    return null;
  }

  /**
   * 创建技能对象
   */
  private _createSkill(
    rawContent: string,
    filePath: string,
    source: 'builtin' | 'workspace'
  ): Skill {
    const meta = this._parseFrontmatter(rawContent);
    const octobotMeta = this._parseNanobotMetadata(meta.metadata);
    const content = this._stripFrontmatter(rawContent);
    const name = meta.name || path.basename(path.dirname(filePath));

    return {
      info: {
        name,
        path: filePath,
        source,
        available: this._checkRequirements(octobotMeta),
        meta: { ...meta, name },
        octobotMeta,
      },
      rawContent,
      content,
    };
  }

  /**
   * 解析 YAML frontmatter
   *
   * 格式：
   * ---
   * name: skill-name
   * description: Skill description
   * always: true
   * metadata: {"octobot": {...}}
   * ---
   */
  private _parseFrontmatter(content: string): SkillMetadata {
    if (!content.startsWith('---')) {
      return DEFAULT_SKILL_METADATA;
    }

    const match = content.match(/^---\n(.*?)\n---\n/s);
    if (!match) {
      return DEFAULT_SKILL_METADATA;
    }

    const frontmatter = match[1];
    const meta: Record<string, string | boolean> = {};

    // 简单解析 YAML（只支持 key: value 格式）
    for (const line of frontmatter.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      let value: string | boolean = line.slice(colonIndex + 1).trim();

      // 处理布尔值
      if (value === 'true') value = true;
      else if (value === 'false') value = false;

      meta[key] = value;
    }

    // 构建 SkillMetadata
    const result: SkillMetadata = {
      ...DEFAULT_SKILL_METADATA,
      name: typeof meta.name === 'string' ? meta.name : DEFAULT_SKILL_METADATA.name,
      description: typeof meta.description === 'string' ? meta.description : DEFAULT_SKILL_METADATA.description,
      always: typeof meta.always === 'boolean' ? meta.always : DEFAULT_SKILL_METADATA.always,
    };

    // metadata 字段保持原样（JSON 字符串）
    if (typeof meta.metadata === 'string') {
      result.metadata = meta.metadata;
    }

    return result;
  }

  /**
   * 解析 octobot 元数据
   */
  private _parseNanobotMetadata(metadataJson?: string): NanobotMetadata {
    if (!metadataJson) return {};

    try {
      const data = JSON.parse(metadataJson);
      // 支持 octobot 或 openclaw 键
      return data.octobot || data.openclaw || {};
    } catch {
      return {};
    }
  }

  /**
   * 检查依赖要求
   */
  private _checkRequirements(meta: NanobotMetadata): boolean {
    const requires = meta.requires;
    if (!requires) return true;

    // 检查二进制文件
    if (requires.bins) {
      for (const bin of requires.bins) {
        if (!this._commandExists(bin)) {
          return false;
        }
      }
    }

    // 检查环境变量
    if (requires.env) {
      for (const env of requires.env) {
        if (!process.env[env]) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 检查命令是否存在
   */
  private _commandExists(command: string): boolean {
    try {
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 移除 frontmatter
   */
  private _stripFrontmatter(content: string): string {
    if (content.startsWith('---')) {
      const match = content.match(/^---\n.*?\n---\n/s);
      if (match) {
        return content.slice(match[0].length).trim();
      }
    }
    return content;
  }

  /**
   * 获取始终加载的技能
   */
  async getAlwaysSkills(): Promise<SkillInfo[]> {
    const allSkills = await this.listSkills({ filterUnavailable: true });
    return allSkills.filter((s) => s.meta.always === true);
  }

  /**
   * 获取缺失的依赖描述
   */
  getMissingRequirements(skill: SkillInfo): string {
    const missing: string[] = [];
    const requires = skill.octobotMeta.requires;

    if (requires?.bins) {
      for (const bin of requires.bins) {
        if (!this._commandExists(bin)) {
          missing.push(`CLI: ${bin}`);
        }
      }
    }

    if (requires?.env) {
      for (const env of requires.env) {
        if (!process.env[env]) {
          missing.push(`ENV: ${env}`);
        }
      }
    }

    return missing.join(', ');
  }
}
