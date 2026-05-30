import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  PluginInstallSchema,
  PluginManifestSchema,
  PluginSkillManifestSchema,
  SkillInstallSchema,
  type PluginInstall,
  type PluginManifest,
  type SkillInstall,
  type PluginSkillManifest,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

const execFileAsync = promisify(execFile);
const now = () => new Date().toISOString();

export interface PluginInstallInput {
  organizationId: string;
  createdBy: string;
  sourceUrl: string;
}

export interface SkillInvocation {
  skill: SkillInstall;
  content: string;
}

interface ParsedSkill {
  manifest: PluginSkillManifest;
  content: string;
}

interface SkillSource {
  skillPath: string;
  fallback?: PluginSkillManifest;
}

const SKILL_COLLECTION_DIRS = ['skills', '.claude/skills', '.cursor/skills'] as const;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  return ['true', 'yes', '1', 'on'].includes(normalized);
}

function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('---')) {
    return { data: {}, body: source };
  }

  const lines = trimmed.split('\n');
  if (lines.length < 3) {
    return { data: {}, body: source };
  }

  const data: Record<string, string> = {};
  let index = 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (line.trim() === '---') {
      return { data, body: lines.slice(index + 1).join('\n').trimStart() };
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match?.[1]) {
      const key = match[1];
      const raw = match[2] ?? '';
      data[key] = raw.replace(/^['"]|['"]$/g, '').trim();
    }
  }

  return { data: {}, body: source };
}

function deriveFallbackDescription(body: string, name: string): string {
  const line = body
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith('#'));
  return line ?? `Skill ${name}`;
}

interface ParsedPluginManifest {
  manifest: PluginManifest;
  skillsDir?: string;
}

function normalizeRelativeDir(value: string): string | undefined {
  const trimmed = value.trim().replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '');
  if (!trimmed) return undefined;
  if (trimmed.startsWith('..') || trimmed.includes('/../') || /[<>:"|?*]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function readPluginManifest(source: string): ParsedPluginManifest {
  const raw = JSON.parse(source) as {
    name?: string;
    description?: string;
    version?: string;
    author?: string | { name?: string };
    skills?: string | Record<string, unknown>[] | unknown;
  };
  const author =
    typeof raw.author === 'string'
      ? raw.author
      : typeof raw.author?.name === 'string'
        ? raw.author.name
        : undefined;

  let skills: PluginManifest['skills'] = [];
  let skillsDir: string | undefined;

  if (Array.isArray(raw.skills)) {
    skills = raw.skills
      .map((skill) => {
        if (!skill || typeof skill !== 'object') return null;
        const item = skill as Record<string, unknown>;
        if (typeof item.name !== 'string') return null;
        return {
          name: item.name,
          description: typeof item.description === 'string' ? item.description : item.name,
          userInvocable: item.userInvocable === true,
          disableModelInvocation: item.disableModelInvocation === true,
          metadata: {},
        };
      })
      .filter((skill): skill is NonNullable<typeof skill> => skill !== null);
  } else if (typeof raw.skills === 'string') {
    skillsDir = normalizeRelativeDir(raw.skills);
  }

  return {
    manifest: PluginManifestSchema.parse({
      name: raw.name,
      description: raw.description ?? '',
      version: raw.version ?? '0.0.0',
      author,
      skills,
    }),
    skillsDir,
  };
}

function githubCloneUrl(url: URL): string {
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'github.com' && parts.length >= 2) {
    return `${url.origin}/${parts[0]}/${parts[1]}.git`;
  }
  return url.toString();
}

function isRepoShorthand(value: string): boolean {
  return /^[^/]+\/[^/]+(?:@.+)?$/.test(value) && !value.includes('://');
}

function normalizeRepoUrl(sourceUrl: string): string {
  if (isRepoShorthand(sourceUrl)) {
    const [repo, ref] = sourceUrl.split('@', 2);
    return ref ? `https://github.com/${repo}.git#${ref}` : `https://github.com/${repo}.git`;
  }
  return sourceUrl;
}

function normalizeTreeSourceUrl(sourceUrl: string): { cloneUrl: string; subdir: string; ref?: string } {
  const normalized = normalizeRepoUrl(sourceUrl.trim());
  const hashIndex = normalized.indexOf('#');
  const urlWithoutHash = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const hashRef = hashIndex >= 0 ? decodeURIComponent(normalized.slice(hashIndex + 1)) : undefined;
  const url = new URL(urlWithoutHash.startsWith('http') ? urlWithoutHash : `https://${urlWithoutHash}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const treeIndex = parts.indexOf('tree');
  const blobIndex = parts.indexOf('blob');
  const segmentIndex = treeIndex >= 0 ? treeIndex : blobIndex;
  if (url.hostname === 'github.com' && parts.length >= 4 && segmentIndex >= 0) {
    const cloneUrl = `${url.origin}/${parts[0]}/${parts[1]}.git`;
    const ref = parts[segmentIndex + 1] ?? hashRef;
    const pathParts = parts.slice(segmentIndex + 2);
    // For blob (file) URLs, drop the trailing filename so we clone the directory containing it.
    const subdir = (treeIndex < 0 && blobIndex >= 0 ? pathParts.slice(0, -1) : pathParts).join('/');
    return { cloneUrl, ref, subdir };
  }
  if (url.hostname === 'github.com') {
    return { cloneUrl: githubCloneUrl(url), subdir: '', ref: hashRef };
  }
  return { cloneUrl: urlWithoutHash, subdir: '', ref: hashRef };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isCommitRef(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref);
}

async function fetchRefCheckout(cloneUrl: string, targetDir: string, ref: string): Promise<void> {
  await execFileAsync('git', ['init', targetDir], { env: process.env });
  await execFileAsync('git', ['-C', targetDir, 'remote', 'add', 'origin', cloneUrl], { env: process.env });
  await execFileAsync('git', ['-C', targetDir, 'fetch', '--depth', '1', 'origin', ref], { env: process.env });
  await execFileAsync('git', ['-C', targetDir, 'checkout', 'FETCH_HEAD'], { env: process.env });
}

async function cloneRepository(sourceUrl: string, targetDir: string): Promise<string> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  const { cloneUrl, ref, subdir } = normalizeTreeSourceUrl(sourceUrl);

  if (!ref) {
    await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, targetDir], { env: process.env });
  } else if (isCommitRef(ref)) {
    await fetchRefCheckout(cloneUrl, targetDir, ref);
  } else {
    try {
      await execFileAsync(
        'git',
        ['clone', '--depth', '1', '--branch', ref, '--single-branch', cloneUrl, targetDir],
        { env: process.env },
      );
    } catch {
      await fetchRefCheckout(cloneUrl, targetDir, ref);
    }
  }

  return subdir ? join(targetDir, subdir) : targetDir;
}

async function parseSkillFile(
  filePath: string,
  fallback?: PluginSkillManifest,
): Promise<ParsedSkill | null> {
  const raw = await readFile(filePath, 'utf8').catch(() => '');
  if (!raw) return null;
  const { data, body } = parseFrontmatter(raw);
  const skillName = data.name || fallback?.name || filePath.split('/').at(-2) || 'skill';
  const description =
    data.description ||
    fallback?.description ||
    deriveFallbackDescription(body, skillName);
  const manifest = PluginSkillManifestSchema.parse({
    name: skillName,
    description,
    userInvocable: parseBool(data['user-invocable'], fallback?.userInvocable ?? true),
    disableModelInvocation: parseBool(
      data['disable-model-invocation'],
      fallback?.disableModelInvocation ?? false,
    ),
    metadata: fallback?.metadata ?? {},
  });
  return {
    manifest,
    content: body.trim(),
  };
}

function toCommandName(pluginName: string, skillName: string, standalone: boolean): string {
  if (standalone) return slugify(skillName);
  return `${slugify(pluginName)}:${slugify(skillName)}`;
}

function renderLoadedSkill(
  skill: SkillInstall,
  instructions: string,
  argumentsText = '',
): string {
  return [
    '<loaded_skill>',
    `  <name>${skill.commandName}</name>`,
    `  <description>${skill.description}</description>`,
    `  <location>${skill.skillPath}</location>`,
    `  <arguments>${argumentsText.trim()}</arguments>`,
    '  <instructions>',
    instructions.trim(),
    '  </instructions>',
    '</loaded_skill>',
  ].join('\n');
}

async function listSkillCollectionSources(repoRoot: string, relativeDir: string): Promise<SkillSource[]> {
  const skillDirs = await readdir(join(repoRoot, relativeDir), { withFileTypes: true }).catch(() => []);
  const candidates = skillDirs
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      skillPath: join(relativeDir, entry.name, 'SKILL.md'),
    }));

  const verified: SkillSource[] = [];
  for (const candidate of candidates) {
    if (await pathExists(join(repoRoot, candidate.skillPath))) {
      verified.push(candidate);
    }
  }
  return verified;
}

async function readRepoPluginManifest(repoRoot: string): Promise<ParsedPluginManifest | null> {
  for (const dir of ['.codex-plugin', '.claude-plugin'] as const) {
    const manifestPath = join(repoRoot, dir, 'plugin.json');
    if (await pathExists(manifestPath)) {
      return readPluginManifest(await readFile(manifestPath, 'utf8'));
    }
  }
  return null;
}

interface MarketplaceEntry {
  name: string;
  pluginRoot: string;
}

async function readMarketplaceLocalPlugins(repoRoot: string): Promise<MarketplaceEntry[] | null> {
  const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');
  if (!(await pathExists(marketplacePath))) return null;

  const raw = JSON.parse(await readFile(marketplacePath, 'utf8')) as {
    plugins?: { name?: string; source?: unknown }[];
  };

  const entries: MarketplaceEntry[] = [];
  for (const plugin of raw.plugins ?? []) {
    if (typeof plugin.source !== 'string' || !plugin.source.startsWith('./')) continue;
    const relative = plugin.source.replace(/^\.\//, '');
    const pluginRoot = join(repoRoot, relative);
    if (!(await pathExists(pluginRoot))) continue;
    entries.push({
      name: typeof plugin.name === 'string' ? plugin.name : relative,
      pluginRoot,
    });
  }

  return entries.length > 0 ? entries : null;
}

async function discoverSkillSources(repoRoot: string): Promise<{ manifest?: PluginManifest; sources: SkillSource[] }> {
  const parsed = await readRepoPluginManifest(repoRoot);
  if (parsed) {
    const { manifest, skillsDir } = parsed;
    const manifestSkills = new Map(
      manifest.skills.map((skill) => [slugify(skill.name), skill] as const),
    );

    const candidateDirs = [
      ...(skillsDir ? [skillsDir] : []),
      'skills',
      ...SKILL_COLLECTION_DIRS.filter((dir) => dir !== 'skills'),
    ];

    for (const relativeDir of candidateDirs) {
      const sources = await listSkillCollectionSources(repoRoot, relativeDir);
      if (sources.length === 0) continue;
      const resolved = sources.map((source) => ({
        ...source,
        fallback: manifestSkills.get(slugify(source.skillPath.split('/').at(-2) ?? '')),
      }));
      return { manifest, sources: resolved };
    }

    throw new Error('Plugin manifest found but no skills directory exists.');
  }

  if (await pathExists(join(repoRoot, 'SKILL.md'))) {
    return { sources: [{ skillPath: 'SKILL.md' }] };
  }

  for (const relativeDir of SKILL_COLLECTION_DIRS) {
    const sources = await listSkillCollectionSources(repoRoot, relativeDir);
    if (sources.length > 0) {
      return { sources };
    }
  }

  // The repo root itself may be a skills-collection folder (e.g. when the user pastes
  // a tree URL pointing at a `skills/` directory, or a tarball whose top-level dirs are skills).
  const rootCollection = await listSkillCollectionSources(repoRoot, '.');
  if (rootCollection.length > 0) {
    return { sources: rootCollection };
  }

  throw new Error(
    'No installable skill found at this path.',
  );
}

export class PluginRegistryService {
  constructor(
    private readonly repo: ApiRepository,
    private readonly homeDir = process.env.UJIMA_HOME ?? process.cwd(),
  ) {}

  private get cacheDir(): string {
    return join(this.homeDir, 'plugins', 'cache');
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  async installFromUrl(input: PluginInstallInput): Promise<{ plugin: PluginInstall; skills: SkillInstall[] }> {
    await this.ensureDirs();
    const cloneDir = join(this.cacheDir, slugify(input.sourceUrl));
    const repoRoot = await cloneRepository(input.sourceUrl, cloneDir);

    try {
      return await this.installPluginFromRoot(input, repoRoot, input.sourceUrl);
    } catch (err) {
      const marketplace = await readMarketplaceLocalPlugins(repoRoot);
      if (marketplace) {
        return this.installMarketplace(input, marketplace);
      }
      throw err;
    }
  }

  private listMarketplaceInstalls(organizationId: string, marketplaceUrl: string): PluginInstall[] {
    return this.repo.listPluginInstalls(organizationId).filter(
      (install) =>
        install.sourceUrl === marketplaceUrl || install.sourceUrl.startsWith(`${marketplaceUrl}::`),
    );
  }

  private removeStaleMarketplaceInstalls(
    organizationId: string,
    marketplaceUrl: string,
    keepSourceUrls: ReadonlySet<string>,
  ): void {
    for (const install of this.listMarketplaceInstalls(organizationId, marketplaceUrl)) {
      if (!keepSourceUrls.has(install.sourceUrl)) {
        this.repo.deletePluginInstall(organizationId, install.id);
      }
    }
  }

  private async installMarketplace(
    input: PluginInstallInput,
    entries: MarketplaceEntry[],
  ): Promise<{ plugin: PluginInstall; skills: SkillInstall[] }> {
    const plugins: PluginInstall[] = [];
    const skills: SkillInstall[] = [];
    const failures: string[] = [];

    for (const entry of entries) {
      try {
        const result = await this.installPluginFromRoot(
          input,
          entry.pluginRoot,
          `${input.sourceUrl}::${entry.name}`,
        );
        plugins.push(result.plugin);
        skills.push(...result.skills);
      } catch (err) {
        failures.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (skills.length === 0) {
      throw new Error(
        failures.length > 0
          ? `Marketplace install failed: ${failures.slice(0, 3).join('; ')}`
          : 'No skills found in marketplace plugins.',
      );
    }

    this.removeStaleMarketplaceInstalls(
      input.organizationId,
      input.sourceUrl,
      new Set(plugins.map((plugin) => plugin.sourceUrl)),
    );

    const plugin = plugins[0];
    if (!plugin) {
      throw new Error('No skills found in marketplace plugins.');
    }
    return { plugin, skills };
  }

  private async installPluginFromRoot(
    input: PluginInstallInput,
    repoRoot: string,
    sourceUrl: string,
  ): Promise<{ plugin: PluginInstall; skills: SkillInstall[] }> {
    const { manifest, sources } = await discoverSkillSources(repoRoot);
    const standalone = !manifest;

    const parsedSources: { source: SkillSource; parsed: ParsedSkill }[] = [];
    for (const source of sources) {
      const parsed = await parseSkillFile(join(repoRoot, source.skillPath), source.fallback);
      if (parsed) parsedSources.push({ source, parsed });
    }

    if (parsedSources.length === 0) {
      throw new Error('Skill files were found but none could be parsed.');
    }

    const firstSkill = parsedSources[0]?.parsed.manifest.name;
    const firstDirName = sources[0]?.skillPath.split('/').at(-2);
    const pluginName =
      manifest?.name ??
      (standalone && parsedSources.length === 1 ? firstSkill : undefined) ??
      slugify(firstDirName ?? basename(repoRoot) ?? 'skill') ??
      'skill';
    const pluginId = slugify(pluginName);

    const existing = this.repo.getPluginInstallBySourceUrl(input.organizationId, sourceUrl);
    if (existing) {
      this.repo.deletePluginInstall(input.organizationId, existing.id);
    }

    const plugin = this.repo.savePluginInstall(
      PluginInstallSchema.parse({
        id: randomUUID(),
        organizationId: input.organizationId,
        pluginId,
        pluginName,
        version: manifest?.version ?? '0.0.0',
        sourceUrl,
        localPath: repoRoot,
        status: 'installed',
        createdBy: input.createdBy,
        createdAt: now(),
        updatedAt: now(),
      }),
    );

    const installs: SkillInstall[] = [];
    for (const { source, parsed } of parsedSources) {
      const commandName = toCommandName(
        pluginName,
        parsed.manifest.name,
        standalone && parsedSources.length === 1,
      );
      const skill = this.repo.saveOrganizationSkillInstall(
        SkillInstallSchema.parse({
          id: randomUUID(),
          organizationId: input.organizationId,
          pluginInstallId: plugin.id,
          pluginId: plugin.pluginId,
          pluginName: plugin.pluginName,
          skillName: parsed.manifest.name,
          commandName,
          description: parsed.manifest.description,
          userInvocable: parsed.manifest.userInvocable,
          disableModelInvocation: parsed.manifest.disableModelInvocation,
          skillPath: source.skillPath,
          createdAt: now(),
          updatedAt: now(),
        }),
      );
      installs.push(skill);
    }

    return { plugin, skills: installs };
  }

  deleteSkill(organizationId: string, skillId: string): void {
    const skill = this.repo.getOrganizationSkillInstall(organizationId, skillId);
    if (!skill) {
      throw new Error('Skill not found');
    }
    const { pluginInstallId } = skill;
    this.repo.deleteOrganizationSkillInstall(organizationId, skillId);
    const hasRemaining = this.repo
      .listOrganizationSkillInstalls(organizationId)
      .some((item) => item.pluginInstallId === pluginInstallId);
    if (!hasRemaining) {
      this.repo.deletePluginInstall(organizationId, pluginInstallId);
    }
  }

  async getSkillInvocation(
    organizationId: string,
    skillId: string,
    argumentsText = '',
  ): Promise<SkillInvocation> {
    const skill = this.repo.getOrganizationSkillInstall(organizationId, skillId);
    if (!skill) {
      throw new Error('Skill not found');
    }
    const plugin = this.repo.getPluginInstall(organizationId, skill.pluginInstallId);
    if (!plugin) {
      throw new Error('Plugin install not found');
    }
    const markdown = await readFile(resolve(plugin.localPath, skill.skillPath), 'utf8');
    return {
      skill,
      content: renderLoadedSkill(skill, markdown, argumentsText),
    };
  }
}
