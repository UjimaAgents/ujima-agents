import type { MCPDef } from '@ujima/shared';

// Catalog-level metadata for the dispatch plan's discovery/connector
// flows (mcp_connector_dispatch_plan.md §17.5, Appendix B). All five
// new fields are optional so every existing entry stays valid as-is.
export type RegistryTransportKind = 'remote' | 'stdio';
export type RegistryAuthMode = 'none' | 'pat' | 'oauth';

export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  homepage?: string;
  tags: string[];
  requires?: { envVars?: string[]; args?: { key: string; description: string }[] };
  defaults: Omit<MCPDef, 'id' | 'name'>;
  knownDestructiveTools?: string[];
  // Readable indicator for UI / catalog rendering; mirrors `defaults.transport`'s
  // nature without forcing settings code to inspect the nested MCPDef.
  transportKind?: RegistryTransportKind;
  // What auth scheme the vendor ships. 'oauth' entries are listed for
  // discovery but rejected at `instantiateFromRegistry` until the OAuth
  // PR lands; 'pat' uses the existing secret-backed headers/env map;
  // 'none' is the no-auth case (Context7, the reference stdio servers).
  authMode?: RegistryAuthMode;
  // Vendor doc URL where the user fetches the PAT (or learns about
  // OAuth). Surfaced in the settings UI's "Add" form.
  setupHint?: string;
  // ISO date (YYYY-MM-DD) of the last manual verification that the
  // vendor's endpoint + auth shape still matches this entry. Drives
  // an age-out chip in the catalog and the quarterly sweep job.
  lastVerified?: string;
  // Catalog text rendered verbatim into the system prompt / search
  // results when present. When absent (community/un-curated entries),
  // the §7.2 renderer falls back to structural facts only — closing
  // the prompt-injection surface from §17.5.7.
  curatedDescription?: string;
  // Agent-attachments hint modifying mime-detection: an array of
  // categories widens capture for known generators; `'never'`
  // suppresses capture even when mime detection succeeds.
  capturesAttachments?: ('image' | 'document' | 'audio' | 'video')[] | 'never';
}

export const CURATED_REGISTRY: RegistryEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description:
      'Read and write files inside a scoped directory. Great for generating code artifacts and reading source files.',
    category: 'filesystem',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    tags: ['files', 'fs', 'read', 'write'],
    requires: {
      args: [
        {
          key: 'rootDir',
          description: 'Absolute path to the directory the MCP is allowed to touch.',
        },
      ],
    },
    defaults: {
      version: '0.0.0',
      description:
        'Read and write files inside a scoped directory. Great for generating code artifacts and reading source files.',
      category: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${rootDir}'],
      env: {},
      isolation: 'shared',
    },
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and inspect a local SQLite database. Read-only schema/table access.',
    category: 'database',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    tags: ['db', 'sql', 'sqlite'],
    requires: {
      args: [
        { key: 'dbPath', description: 'Absolute path to the .sqlite or .db file to open.' },
      ],
    },
    defaults: {
      version: '0.0.0',
      description: 'Query and inspect a local SQLite database. Read-only schema/table access.',
      category: 'database',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', '${dbPath}'],
      env: {},
      isolation: 'shared',
    },
  },
  {
    id: 'figma-ai-bridge',
    name: 'Figma AI Bridge',
    description:
      'Read Figma frames + write design tokens via figma-developer-mcp. Requires a Figma personal access token (FIGMA_API_KEY).',
    category: 'design',
    homepage: 'https://github.com/GLips/Figma-Context-MCP',
    tags: ['figma', 'design', 'frames', 'tokens'],
    requires: {
      envVars: ['FIGMA_API_KEY'],
    },
    defaults: {
      version: '0.0.0',
      description: 'Read Figma frames + write design tokens via figma-developer-mcp.',
      category: 'design',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'figma-developer-mcp', '--stdio'],
      env: {},
      isolation: 'shared',
    },
    knownDestructiveTools: ['delete_node', 'delete_nodes', 'update_styles', 'publish_library'],
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description:
      'Microsoft Playwright MCP — drive a real browser, grab snapshots, run E2E flows, codegen.',
    category: 'browser',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    tags: ['browser', 'e2e', 'test', 'playwright'],
    defaults: {
      version: '0.0.0',
      description: 'Microsoft Playwright MCP — drive a real browser and run E2E flows.',
      category: 'browser',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {},
      isolation: 'per-agent',
    },
    knownDestructiveTools: ['browser_close', 'browser_kill', 'browser_execute_js'],
    capturesAttachments: ['image'],
  },
  {
    id: 'git',
    name: 'Git (local)',
    description:
      'Run git operations inside a local repo — status, diff, add, commit, branch, checkout. Lets engineering agents produce reviewable changes through permission presets instead of writing straight to the tree.',
    category: 'vcs',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    tags: ['git', 'vcs', 'diff', 'commit', 'branch'],
    requires: {
      args: [
        { key: 'rootDir', description: 'Absolute path to the local git repository.' },
      ],
    },
    defaults: {
      version: '0.0.0',
      description: 'Git operations on a local repository via mcp-server-git.',
      category: 'vcs',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git', '--repository', '${rootDir}'],
      env: {},
      isolation: 'per-agent',
    },
    knownDestructiveTools: ['git_reset', 'git_checkout', 'git_init'],
  },
  {
    id: 'github',
    name: 'GitHub',
    description:
      'GitHub MCP — read/write issues, pull requests, branches, and files via the GitHub API. Requires GITHUB_PERSONAL_ACCESS_TOKEN.',
    category: 'vcs',
    homepage: 'https://github.com/github/github-mcp-server',
    tags: ['github', 'vcs', 'issues', 'pr', 'api'],
    requires: { envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'] },
    defaults: {
      version: '0.0.0',
      description: 'GitHub issues, PRs, branches, and file operations via the GitHub API.',
      category: 'vcs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {},
      isolation: 'shared',
    },
    knownDestructiveTools: [
      'create_or_update_file',
      'push_files',
      'create_repository',
      'delete_file',
      'merge_pull_request',
      'update_issue',
      'update_pull_request_branch',
    ],
  },
  {
    id: 'postgres',
    name: 'Postgres (read-only)',
    description:
      'Postgres MCP — run read-only SQL against a remote or local Postgres database. Connection string is passed as an argument.',
    category: 'database',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    tags: ['db', 'sql', 'postgres', 'readonly'],
    requires: {
      args: [
        {
          key: 'connectionString',
          description:
            'Postgres connection URL, e.g. postgres://user:pass@host:5432/db. Read-only recommended.',
        },
      ],
    },
    defaults: {
      version: '0.0.0',
      description: 'Read-only SQL queries against a Postgres database.',
      category: 'database',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', '${connectionString}'],
      env: {},
      isolation: 'shared',
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    description:
      'Notion MCP — search, fetch, create, update, and move pages. Requires a Notion integration token.',
    category: 'docs',
    homepage: 'https://github.com/makenotion/notion-mcp-server',
    tags: ['notion', 'docs', 'wiki', 'pages'],
    requires: { envVars: ['NOTION_API_KEY'] },
    defaults: {
      version: '0.0.0',
      description: 'Notion workspace operations via the Notion API.',
      category: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: {},
      isolation: 'shared',
    },
    knownDestructiveTools: [
      'notion-create-pages',
      'notion-update-page',
      'notion-move-pages',
      'notion-duplicate-page',
      'notion-update-data-source',
      'notion-create-database',
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    description:
      'Slack MCP — read channels/threads, post messages, add reactions. Requires SLACK_BOT_TOKEN and SLACK_TEAM_ID.',
    category: 'messaging',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    tags: ['slack', 'chat', 'messaging'],
    requires: { envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'] },
    defaults: {
      version: '0.0.0',
      description: 'Slack channel and thread operations via the Slack API.',
      category: 'messaging',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {},
      isolation: 'shared',
    },
    knownDestructiveTools: [
      'slack_post_message',
      'slack_reply_to_thread',
      'slack_add_reaction',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // Track A — remote-hosted MCPs (PAT or no-auth only).
  // Each uses the existing `http-streamable` transport with the secret-
  // backed Authorization header. OAuth-only vendors are listed further
  // down with `authMode: 'oauth'` so the catalog surfaces them but
  // `instantiateFromRegistry` throws a clear error until the OAuth PR
  // ships. Re-verify the endpoint URLs and PAT shapes if `lastVerified`
  // ages past ~90 days; vendors do shift these.
  // ─────────────────────────────────────────────────────────────────────

  {
    id: 'github-mcp',
    name: 'GitHub MCP (remote)',
    description:
      'Official GitHub remote MCP — issues, PRs, repos, code search via the GitHub API. Pair with a GitHub PAT.',
    category: 'vcs',
    homepage: 'https://github.com/github/github-mcp-server',
    tags: ['github', 'vcs', 'issues', 'pr', 'code-search', 'remote'],
    transportKind: 'remote',
    authMode: 'pat',
    setupHint: 'https://github.com/settings/tokens',
    lastVerified: '2026-06-05',
    curatedDescription:
      'GitHub issues, PRs, repos, code search, and file operations via the GitHub API. Use for: opening PRs, triaging issues, searching code across an org. Authenticates with a fine-grained or classic Personal Access Token.',
    requires: { envVars: ['GITHUB_TOKEN'] },
    defaults: {
      version: '0.0.0',
      description: 'GitHub remote MCP via the GitHub API.',
      category: 'vcs',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer ${GITHUB_TOKEN}' },
      isolation: 'shared',
    },
    knownDestructiveTools: [
      'create_or_update_file',
      'push_files',
      'create_repository',
      'delete_file',
      'merge_pull_request',
      'update_issue',
      'update_pull_request_branch',
    ],
  },

  {
    id: 'context7',
    name: 'Context7',
    description:
      'Live, version-specific library documentation — fetch up-to-date docs for any public package so the model writes code against the current API, not stale training data. No auth required.',
    category: 'docs',
    homepage: 'https://context7.com',
    tags: ['docs', 'libraries', 'reference', 'remote', 'no-auth'],
    transportKind: 'remote',
    authMode: 'none',
    setupHint: 'https://context7.com',
    lastVerified: '2026-06-05',
    curatedDescription:
      'Live library docs for any public package — eliminates stale-training-data hallucinations when the model writes against an unfamiliar API. Use for: looking up current React/Next/Stripe/etc. docs mid-task. No auth needed for public packages.',
    defaults: {
      version: '0.0.0',
      description: 'Live library documentation via the Context7 API.',
      category: 'docs',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://mcp.context7.com/mcp',
      isolation: 'shared',
    },
  },

  {
    id: 'sentry-mcp',
    name: 'Sentry',
    description:
      'Sentry remote MCP — query errors, releases, performance issues. Authenticates with a Sentry user auth token.',
    category: 'observability',
    homepage: 'https://docs.sentry.io/product/sentry-mcp/',
    tags: ['sentry', 'errors', 'observability', 'releases', 'remote'],
    transportKind: 'remote',
    authMode: 'pat',
    setupHint: 'https://sentry.io/settings/account/api/auth-tokens/',
    lastVerified: '2026-06-05',
    curatedDescription:
      'Sentry errors, releases, and performance issues. Use for: incident triage, mapping a stack trace to recent deploys, identifying which release introduced a regression. Authenticates with a user auth token.',
    requires: { envVars: ['SENTRY_AUTH_TOKEN'] },
    defaults: {
      version: '0.0.0',
      description: 'Sentry remote MCP for error and release data.',
      category: 'observability',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://mcp.sentry.dev/mcp',
      headers: { Authorization: 'Bearer ${SENTRY_AUTH_TOKEN}' },
      isolation: 'shared',
    },
  },

  {
    id: 'supabase-mcp',
    name: 'Supabase',
    description:
      'Supabase remote MCP — manage projects, run SQL, inspect schema, work with edge functions. Authenticates with a Supabase access token.',
    category: 'database',
    homepage: 'https://supabase.com/docs/guides/getting-started/mcp',
    tags: ['supabase', 'database', 'postgres', 'edge-functions', 'remote'],
    transportKind: 'remote',
    authMode: 'pat',
    setupHint: 'https://supabase.com/dashboard/account/tokens',
    lastVerified: '2026-06-05',
    curatedDescription:
      'Supabase project management, schema inspection, SQL execution, edge-function ops. Use for: provisioning a sandbox project, running ad-hoc queries against a managed Postgres, deploying edge functions. Authenticates with a personal access token.',
    requires: { envVars: ['SUPABASE_ACCESS_TOKEN'] },
    defaults: {
      version: '0.0.0',
      description: 'Supabase project + Postgres ops via the Supabase API.',
      category: 'database',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://api.supabase.com/mcp',
      headers: { Authorization: 'Bearer ${SUPABASE_ACCESS_TOKEN}' },
      isolation: 'shared',
    },
    knownDestructiveTools: [
      'execute_sql',
      'apply_migration',
      'delete_project',
      'create_branch',
      'merge_branch',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // Track A — remote OAuth-only entries.
  // Listed for catalog discovery but cannot be instantiated until the
  // OAuth 2.1 + PKCE flow lands (separate PR). `instantiateFromRegistry`
  // throws a clear "OAuth not yet supported" error referencing
  // `setupHint` so admins know where to wait for the integration.
  // ─────────────────────────────────────────────────────────────────────

  {
    id: 'linear-mcp',
    name: 'Linear',
    description:
      'Linear remote MCP — issues, projects, cycles, comments. OAuth-only (PAT support not exposed by Linear). Listed in catalog; cannot instantiate yet.',
    category: 'project-mgmt',
    homepage: 'https://linear.app/docs/mcp',
    tags: ['linear', 'issues', 'project-mgmt', 'remote', 'oauth'],
    transportKind: 'remote',
    authMode: 'oauth',
    setupHint: 'https://linear.app/docs/mcp',
    lastVerified: '2026-06-05',
    defaults: {
      version: '0.0.0',
      description: 'Linear remote MCP (OAuth-only).',
      category: 'project-mgmt',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://mcp.linear.app/sse',
      isolation: 'shared',
    },
  },

  {
    id: 'vercel-mcp',
    name: 'Vercel',
    description:
      'Vercel remote MCP — deployments, projects, environments, logs. OAuth-only. Listed in catalog; cannot instantiate yet.',
    category: 'infra',
    homepage: 'https://vercel.com/docs/mcp',
    tags: ['vercel', 'deploy', 'infra', 'remote', 'oauth'],
    transportKind: 'remote',
    authMode: 'oauth',
    setupHint: 'https://vercel.com/docs/mcp',
    lastVerified: '2026-06-05',
    defaults: {
      version: '0.0.0',
      description: 'Vercel remote MCP (OAuth-only).',
      category: 'infra',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://mcp.vercel.com/',
      isolation: 'shared',
    },
  },

  {
    id: 'atlassian-mcp',
    name: 'Atlassian (Jira + Confluence)',
    description:
      'Atlassian remote MCP — Jira issues, Confluence pages. OAuth-only via the Atlassian Remote MCP server. Listed in catalog; cannot instantiate yet.',
    category: 'project-mgmt',
    homepage: 'https://www.atlassian.com/blog/announcements/remote-mcp-server',
    tags: ['atlassian', 'jira', 'confluence', 'project-mgmt', 'remote', 'oauth'],
    transportKind: 'remote',
    authMode: 'oauth',
    setupHint: 'https://www.atlassian.com/blog/announcements/remote-mcp-server',
    lastVerified: '2026-06-05',
    defaults: {
      version: '0.0.0',
      description: 'Atlassian remote MCP (OAuth-only).',
      category: 'project-mgmt',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://mcp.atlassian.com/v1/sse',
      isolation: 'shared',
    },
  },

  {
    id: 'notion-remote',
    name: 'Notion (remote, OAuth)',
    description:
      'Notion remote MCP — OAuth-only variant of the Notion connector. For PAT-authenticated stdio access use the existing `notion` entry. Listed; cannot instantiate yet.',
    category: 'docs',
    homepage: 'https://developers.notion.com/docs/mcp',
    tags: ['notion', 'docs', 'wiki', 'remote', 'oauth'],
    transportKind: 'remote',
    authMode: 'oauth',
    setupHint: 'https://developers.notion.com/docs/mcp',
    lastVerified: '2026-06-05',
    defaults: {
      version: '0.0.0',
      description: 'Notion remote MCP (OAuth-only).',
      category: 'docs',
      transport: 'http-streamable',
      command: '',
      args: [],
      env: {},
      url: 'https://mcp.notion.com/mcp',
      isolation: 'shared',
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Track B — Anthropic-maintained reference stdio servers.
  // Light, fast, no-auth. The agent substrate the dispatch plan §B
  // assumed would be available at spawn for built-in reasoning + I/O.
  // ─────────────────────────────────────────────────────────────────────

  {
    id: 'memory',
    name: 'Memory (knowledge graph)',
    description:
      'Persistent knowledge-graph memory across conversations. Entities, relations, and observations stored locally via the official MCP reference server.',
    category: 'memory',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    tags: ['memory', 'knowledge-graph', 'reference', 'stdio'],
    transportKind: 'stdio',
    authMode: 'none',
    setupHint: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    lastVerified: '2026-06-05',
    curatedDescription:
      'A persistent knowledge-graph memory. Use for: remembering facts about entities across conversations, building a graph of relationships, recording observations the agent should consult later. Independent of Ujima\'s four-layer memory — useful for agents that need their own scratch graph.',
    defaults: {
      version: '0.0.0',
      description: 'MCP reference Memory server (knowledge graph).',
      category: 'memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      isolation: 'shared',
    },
    knownDestructiveTools: ['delete_entities', 'delete_relations', 'delete_observations'],
  },

  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description:
      'Structured multi-step reasoning chains via the official MCP reference server. Useful inside an orchestrator\'s planning phase for architectural decisions.',
    category: 'reasoning',
    homepage:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    tags: ['reasoning', 'planning', 'chain-of-thought', 'reference', 'stdio'],
    transportKind: 'stdio',
    authMode: 'none',
    setupHint:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    lastVerified: '2026-06-05',
    curatedDescription:
      'Structured step-by-step reasoning. Use for: architecture decisions, multi-step problem decomposition, planning before execution. The agent emits ordered thought steps and the server replays them as context.',
    defaults: {
      version: '0.0.0',
      description: 'MCP reference Sequential Thinking server.',
      category: 'reasoning',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      env: {},
      isolation: 'shared',
    },
  },

  {
    id: 'fetch',
    name: 'Fetch',
    description:
      'HTTP fetch + HTML-to-Markdown conversion via the official MCP reference server. No auth. Convenient when the agent needs to pull arbitrary public pages.',
    category: 'web',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    tags: ['fetch', 'http', 'web', 'reference', 'stdio'],
    transportKind: 'stdio',
    authMode: 'none',
    setupHint: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    lastVerified: '2026-06-05',
    curatedDescription:
      'Fetch any URL and convert to Markdown. Use for: pulling public web pages, scraping reference content, reading API docs. Treat as egress-capable in classifications — `fetch(url=...)` with an external host is exfiltration shaped as a read.',
    // Fetch output is meant for the agent to reason about (markdown
    // text); never stuff it into the attachment store.
    capturesAttachments: 'never',
    defaults: {
      version: '0.0.0',
      description: 'MCP reference Fetch server (HTTP + Markdown).',
      category: 'web',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      env: {},
      isolation: 'shared',
    },
  },
];

export function listRegistry(): RegistryEntry[] {
  return CURATED_REGISTRY;
}

export function findRegistryEntry(id: string): RegistryEntry | undefined {
  return CURATED_REGISTRY.find((e) => e.id === id);
}

export function searchRegistry(q: string): RegistryEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return CURATED_REGISTRY;
  return CURATED_REGISTRY.filter((e) => {
    const hay = [e.id, e.name, e.description, e.category, ...e.tags].join(' ').toLowerCase();
    return hay.includes(needle);
  });
}

export interface InstantiateOptions {
  overrideId?: string;
  overrideName?: string;
  argSubstitutions?: Record<string, string>;
  envOverrides?: Record<string, string>;
}

export function instantiateFromRegistry(
  entryId: string,
  options: InstantiateOptions = {},
): MCPDef {
  const entry = findRegistryEntry(entryId);
  if (!entry) {
    throw new Error(`Unknown registry entry: "${entryId}"`);
  }
  if (entry.authMode === 'oauth') {
    // OAuth entries appear in the catalog so admins can see what's coming
    // (and so the IT-guy / search_catalog meta-tools find them at
    // discovery time), but the 2.1 + PKCE flow lands in a separate PR.
    // Throw a clear message rather than silently producing a half-
    // configured MCPDef that would fail at connection time with an
    // opaque error.
    const where = entry.setupHint ? ` See ${entry.setupHint}.` : '';
    throw new Error(
      `OAuth authentication is not yet supported for "${entry.name}". ` +
        `This entry is listed in the catalog for discovery; the OAuth ` +
        `flow will land in a follow-up PR.${where}`,
    );
  }

  const subs = options.argSubstitutions ?? {};
  const args = entry.defaults.args.map((arg) => substitute(arg, subs));
  const env = { ...entry.defaults.env, ...(options.envOverrides ?? {}) };

  // Substitute headers from the resolved env map so PAT-auth remote
  // entries like `Bearer ${GITHUB_TOKEN}` become `Bearer ghp_actual_…`
  // when the caller supplies the token via envOverrides. Without this,
  // buildTransport (transport.ts:requestOptions) forwards the literal
  // placeholder as the Authorization header and the vendor's API
  // returns 401 with no clue that a substitution was expected.
  // Placeholders that aren't in env fall through unchanged — same
  // semantics as the args substitution above. The caller is responsible
  // for supplying every value its chosen entry's `requires.envVars`
  // declares; the instantiate path doesn't enforce that, but settings
  // forms should validate before instantiating.
  const headers = entry.defaults.headers
    ? Object.fromEntries(
        Object.entries(entry.defaults.headers).map(([k, v]) => [k, substitute(v, env)]),
      )
    : undefined;

  return {
    ...entry.defaults,
    id: options.overrideId ?? entry.id,
    name: options.overrideName ?? entry.name,
    args,
    env,
    ...(headers !== undefined ? { headers } : {}),
  };
}

function substitute(template: string, subs: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (match, key: string) => {
    const v = subs[key];
    return v === undefined ? match : v;
  });
}
