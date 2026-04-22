import type { MCPDef } from '@ujima/shared';

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

  const subs = options.argSubstitutions ?? {};
  const args = entry.defaults.args.map((arg) => substitute(arg, subs));
  const env = { ...entry.defaults.env, ...(options.envOverrides ?? {}) };

  return {
    ...entry.defaults,
    id: options.overrideId ?? entry.id,
    name: options.overrideName ?? entry.name,
    args,
    env,
  };
}

function substitute(template: string, subs: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (match, key: string) => {
    const v = subs[key];
    return v === undefined ? match : v;
  });
}
