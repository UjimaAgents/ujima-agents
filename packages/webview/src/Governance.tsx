import { useMemo, useState, type ReactElement } from 'react';
import {
  bucketSamples,
  callsPerMinute,
  evaluatePolicy,
  filterAuditRecords,
  uniqueAuditAgents,
  uniqueAuditTools,
  uniqueAuditTypes,
  type AgentPermissions,
  type AuditFilter,
  type AuditRecord,
  type GovernancePolicy,
  type PendingGate,
  type RateSample,
  type SessionSummary,
  type ToolCatalogEntry,
  type ToolPolicyRule,
  type ToolPolicyState,
} from '@ujima/shared';
import { postToHost, useGovernanceSnapshot, type GovernanceAgentView } from './host-bridge';

const TIME_WINDOWS: { label: string; ms?: number }[] = [
  { label: 'All time' },
  { label: 'Last 1m', ms: 60_000 },
  { label: 'Last 5m', ms: 5 * 60_000 },
  { label: 'Last 15m', ms: 15 * 60_000 },
  { label: 'Last 1h', ms: 60 * 60_000 },
];

type TabKey = 'agents' | 'audit' | 'iam' | 'gates' | 'permissions' | 'rate' | 'history';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'agents', label: 'Live Agents' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'iam', label: 'IAM Matrix' },
  { key: 'gates', label: 'Pending Gates' },
  { key: 'permissions', label: 'Permissions' },
  { key: 'rate', label: 'Rate Dashboard' },
  { key: 'history', label: 'Session History' },
];

const POLICY_CYCLE: ToolPolicyState[] = [
  'inherit',
  'allow',
  'require_approval',
  'require_input',
  'deny',
];

const STATE_LABELS: Record<ToolPolicyState, string> = {
  allow: 'Allow',
  deny: 'Deny',
  require_approval: 'Approve',
  require_input: 'Input',
  inherit: 'Inherit',
};

export function Governance(): ReactElement {
  const snap = useGovernanceSnapshot();
  const [tab, setTab] = useState<TabKey>('agents');

  return (
    <section style={rootStyle}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
          <strong>Ujima Governance</strong>
          <span style={{ opacity: 0.55, fontSize: '0.8em', fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
            session {snap.sessionId || '…'}
          </span>
          <span style={{ opacity: 0.55, fontSize: '0.8em' }}>
            {snap.agents.length} agents · {snap.audit.length} audit records
          </span>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => {
              const ok = window.confirm('Kill the whole Ujima session? All running agents will stop.');
              if (ok) postToHost({ type: 'session.kill' });
            }}
            style={killButtonStyle}
          >
            Kill Session
          </button>
        </div>
        <nav style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem' }}>
          {TABS.map((t) => {
            const badge = t.key === 'gates' && snap.pendingGates.length > 0 ? snap.pendingGates.length : null;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={tab === t.key ? tabActiveStyle : tabStyle}
              >
                {t.label}
                {badge !== null ? (
                  <span style={tabBadgeStyle}>{badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>
      <div style={bodyStyle}>
        {tab === 'agents' ? <LiveAgents agents={snap.agents} /> : null}
        {tab === 'audit' ? <AuditLog records={snap.audit} agents={snap.agents} /> : null}
        {tab === 'iam' ? (
          <IamMatrix agents={snap.agents} policy={snap.policy} catalog={snap.catalog} />
        ) : null}
        {tab === 'gates' ? <PendingGates gates={snap.pendingGates} agents={snap.agents} /> : null}
        {tab === 'permissions' ? <PermissionEditor agents={snap.agents} /> : null}
        {tab === 'rate' ? <RateDashboard agents={snap.agents} rate={snap.rate} /> : null}
        {tab === 'history' ? <SessionHistory sessions={snap.sessions} /> : null}
      </div>
    </section>
  );
}

function LiveAgents({ agents }: { agents: GovernanceAgentView[] }): ReactElement {
  if (agents.length === 0) {
    return <div style={emptyStyle}>No agents registered yet.</div>;
  }
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>MCP</th>
          <th style={thStyle}>Status</th>
          <th style={thStyle}>Action</th>
          <th style={thStyle}>Tokens</th>
          <th style={thStyle} />
        </tr>
      </thead>
      <tbody>
        {agents.map((a) => {
          const pct = a.tokenCap > 0 ? Math.min(100, (a.tokensUsed / a.tokenCap) * 100) : 0;
          return (
            <tr key={a.id} style={{ borderBottom: '1px solid var(--vscode-panel-border, #222)' }}>
              <td style={tdStyle}>
                <div style={{ fontWeight: 600 }}>{a.name}</div>
                <div style={{ opacity: 0.55, fontSize: '0.8em', fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
                  {a.id}
                </div>
              </td>
              <td style={tdStyle}>{a.mcp}</td>
              <td style={tdStyle}>
                <span style={{ color: statusColor(a.status), textTransform: 'capitalize' }}>{a.status}</span>
              </td>
              <td style={{ ...tdStyle, opacity: 0.75 }}>{a.lastAction ?? '—'}</td>
              <td style={tdStyle}>
                <div style={{ opacity: 0.8 }}>
                  {a.tokensUsed.toLocaleString()}
                  {a.tokenCap > 0 ? ` / ${a.tokenCap.toLocaleString()}` : ''}
                </div>
                {a.tokenCap > 0 ? (
                  <div style={{ height: 4, background: 'var(--vscode-editorWidget-border, #333)', borderRadius: 2, marginTop: 2 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: pctColor(pct), borderRadius: 2 }} />
                  </div>
                ) : null}
              </td>
              <td style={tdStyle}>
                <button
                  type="button"
                  disabled={a.status === 'killed'}
                  onClick={() => postToHost({ type: 'agent.kill', payload: { agent_id: a.id } })}
                  style={a.status === 'killed' ? { ...killButtonStyle, opacity: 0.4, cursor: 'not-allowed' } : killButtonStyle}
                >
                  Kill
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AuditLog({
  records,
  agents,
}: {
  records: AuditRecord[];
  agents: GovernanceAgentView[];
}): ReactElement {
  const mcpByAgent = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.mcp);
    return m;
  }, [agents]);
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [allowedOnly, setAllowedOnly] = useState<'all' | 'allowed' | 'blocked'>('all');
  const [windowMs, setWindowMs] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');

  const availableAgents = useMemo(() => uniqueAuditAgents(records), [records]);
  const availableTools = useMemo(() => uniqueAuditTools(records), [records]);
  const availableTypes = useMemo(() => uniqueAuditTypes(records), [records]);

  const filter: AuditFilter = useMemo(
    () => ({
      agents: agentFilter,
      tools,
      types,
      allowed: allowedOnly === 'all' ? undefined : allowedOnly === 'allowed',
      sinceMs: windowMs ? Date.now() - windowMs : undefined,
      search: search.trim() || undefined,
    }),
    [agentFilter, tools, types, allowedOnly, windowMs, search],
  );

  const visible = useMemo(() => filterAuditRecords(records, filter), [records, filter]);
  const windowSliced = useMemo(() => visible.slice(-500), [visible]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--vscode-panel-border, #333)' }}>
        <MultiSelect label="Agent" options={availableAgents} value={agentFilter} onChange={setAgentFilter} />
        <MultiSelect label="Tool" options={availableTools} value={tools} onChange={setTools} />
        <MultiSelect label="Type" options={availableTypes} value={types} onChange={setTypes} />
        <select
          value={allowedOnly}
          onChange={(e) => setAllowedOnly(e.target.value as 'all' | 'allowed' | 'blocked')}
          style={selectStyle}
        >
          <option value="all">All calls</option>
          <option value="allowed">Allowed only</option>
          <option value="blocked">Blocked only</option>
        </select>
        <select
          value={windowMs ?? ''}
          onChange={(e) => setWindowMs(e.target.value ? Number(e.target.value) : undefined)}
          style={selectStyle}
        >
          {TIME_WINDOWS.map((w) => (
            <option key={w.label} value={w.ms ?? ''}>
              {w.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Search tool, input, reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 160 }}
        />
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button type="button" style={buttonStyle} onClick={() => postToHost({ type: 'governance.audit.export', payload: { format: 'json' } })}>
            Export JSON
          </button>
          <button type="button" style={buttonStyle} onClick={() => postToHost({ type: 'governance.audit.export', payload: { format: 'csv' } })}>
            Export CSV
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {windowSliced.length === 0 ? (
          <div style={emptyStyle}>
            {records.length === 0 ? 'No audit records yet.' : 'No records match the current filters.'}
          </div>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {windowSliced.map((r) => (
              <AuditRow key={r.event_id} record={r} mcpId={mcpByAgent.get(r.agent_id)} />
            ))}
          </ol>
        )}
      </div>
      <div style={{ padding: '0.3rem 0.75rem', borderTop: '1px solid var(--vscode-panel-border, #333)', opacity: 0.55, fontSize: '0.75em' }}>
        Showing {windowSliced.length} of {visible.length} filtered / {records.length} total. Scrolls virtually via 500-record window.
      </div>
    </div>
  );
}

function AuditRow({
  record,
  mcpId,
}: {
  record: AuditRecord;
  mcpId: string | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const time = formatTime(record.created_at);
  const allowedColor = record.allowed ? 'var(--vscode-terminal-ansiGreen, #4ec9b0)' : 'var(--vscode-errorForeground, #f48771)';
  const canDeny = Boolean(mcpId && record.tool_name && record.agent_id);
  return (
    <li
      style={{
        borderBottom: '1px solid var(--vscode-panel-border, #222)',
        padding: '0.4rem 0.75rem',
        fontFamily: 'var(--vscode-editor-font-family, ui-monospace, monospace)',
        fontSize: '0.82em',
      }}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} style={rowButtonStyle}>
        <span style={{ opacity: 0.5, minWidth: 76 }}>{time}</span>
        <span style={{ color: allowedColor, minWidth: 60 }}>{record.allowed ? 'allow' : 'block'}</span>
        <span style={{ minWidth: 120, opacity: 0.8 }}>{record.event_type}</span>
        <span style={{ minWidth: 120 }}>{record.agent_id}</span>
        <span style={{ minWidth: 140, opacity: 0.85 }}>{record.tool_name ?? '—'}</span>
        <span style={{ flex: 1, opacity: 0.55 }}>{record.block_reason ?? summarizeValue(record.tool_input)}</span>
        <span style={{ opacity: 0.4 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <>
          <pre style={preStyle}>{JSON.stringify(record, null, 2)}</pre>
          {canDeny ? (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
              <button
                type="button"
                style={buttonStyle}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (!mcpId || !record.tool_name || !record.agent_id) return;
                  const reason = window.prompt(
                    `Deny ${mcpId}:${record.tool_name} for ${record.agent_id}?\nOptional reason:`,
                    record.block_reason ?? '',
                  );
                  if (reason === null) return;
                  postToHost({
                    type: 'governance.policy.update',
                    payload: {
                      op: 'setAgent',
                      agent_id: record.agent_id,
                      rule: {
                        mcp_id: mcpId,
                        tool_name: record.tool_name,
                        state: 'deny',
                        reason: reason.trim() || `Denied from audit log at ${record.created_at}`,
                      },
                    },
                  });
                }}
              >
                Deny this for {record.agent_id}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function PermissionEditor({ agents }: { agents: GovernanceAgentView[] }): ReactElement {
  const [selected, setSelected] = useState<string | undefined>(agents[0]?.id);
  const agent = agents.find((a) => a.id === selected) ?? agents[0];

  if (!agent) {
    return <div style={emptyStyle}>No agents to edit. Onboard one first via Ujima: Onboard New Agent.</div>;
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <aside style={{ width: 200, borderRight: '1px solid var(--vscode-panel-border, #333)', overflowY: 'auto' }}>
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelected(a.id)}
            style={a.id === agent.id ? sidebarItemActive : sidebarItem}
          >
            <div style={{ fontWeight: 600 }}>{a.name}</div>
            <div style={{ opacity: 0.55, fontSize: '0.75em' }}>{a.mcp}</div>
          </button>
        ))}
      </aside>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <PermissionForm key={agent.id} agent={agent} />
      </div>
    </div>
  );
}

function PermissionForm({ agent }: { agent: GovernanceAgentView }): ReactElement {
  const initial: AgentPermissions = agent.permissions ?? {
    allowed_tools: [],
    blocked_tools: [],
    rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
  };
  const [allowed, setAllowed] = useState(initial.allowed_tools.join('\n'));
  const [blocked, setBlocked] = useState(initial.blocked_tools.join('\n'));
  const [callsPerMin, setCallsPerMin] = useState(initial.rate_limit.calls_per_minute);
  const [maxTokens, setMaxTokens] = useState(initial.rate_limit.max_session_tokens);

  const apply = (scope: 'session' | 'def'): void => {
    const permissions: AgentPermissions = {
      allowed_tools: parseList(allowed),
      blocked_tools: parseList(blocked),
      rate_limit: {
        calls_per_minute: Math.max(1, callsPerMin | 0),
        max_session_tokens: Math.max(1, maxTokens | 0),
      },
    };
    postToHost({
      type: 'governance.agent.updatePermissions',
      payload: { agent_id: agent.id, permissions, scope },
    });
  };

  return (
    <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <h3 style={{ margin: '0 0 0.25rem 0' }}>{agent.name}</h3>
        <div style={{ opacity: 0.55, fontSize: '0.8em', fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
          {agent.id} · {agent.mcp}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={labelStyle}>Allowed tools (one per line)</span>
          <textarea value={allowed} onChange={(e) => setAllowed(e.target.value)} rows={10} style={textareaStyle} />
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={labelStyle}>Blocked tools (one per line)</span>
          <textarea value={blocked} onChange={(e) => setBlocked(e.target.value)} rows={10} style={textareaStyle} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={labelStyle}>Calls / minute</span>
          <input
            type="number"
            min={1}
            value={callsPerMin}
            onChange={(e) => setCallsPerMin(Number(e.target.value))}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={labelStyle}>Max session tokens</span>
          <input
            type="number"
            min={1}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            style={inputStyle}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="button" onClick={() => apply('session')} style={buttonPrimaryStyle}>
          Apply to session
        </button>
        <button type="button" onClick={() => apply('def')} style={buttonStyle}>
          Save to agent definition
        </button>
      </div>
      <p style={{ opacity: 0.55, fontSize: '0.8em', margin: 0 }}>
        "Apply to session" changes are live immediately but reset on the next onboarding.
        "Save to agent definition" additionally rewrites <code>.ujima/agents/{agent.id}.json</code>.
      </p>
    </div>
  );
}

function RateDashboard({
  agents,
  rate,
}: {
  agents: GovernanceAgentView[];
  rate: Map<string, RateSample[]>;
}): ReactElement {
  if (agents.length === 0) return <div style={emptyStyle}>No agents to chart.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem 1rem', overflowY: 'auto', height: '100%', minHeight: 0 }}>
      {agents.map((a) => {
        const samples = rate.get(a.id) ?? [];
        const cpm = callsPerMinute(samples);
        const limit = a.permissions?.rate_limit.calls_per_minute ?? 0;
        const ratio = limit > 0 ? cpm / limit : 0;
        return (
          <div
            key={a.id}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--vscode-panel-border, #333)',
              borderRadius: 4,
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 180 }}>
              <div style={{ fontWeight: 600 }}>{a.name}</div>
              <div style={{ opacity: 0.55, fontSize: '0.75em' }}>{a.mcp}</div>
            </div>
            <Sparkline samples={samples} />
            <div style={{ minWidth: 120, textAlign: 'right' }}>
              <div style={{ color: ratio >= 1 ? 'var(--vscode-errorForeground, #f48771)' : ratio >= 0.8 ? 'var(--vscode-editorWarning-foreground, #cca700)' : 'inherit' }}>
                {cpm}{limit > 0 ? ` / ${limit}` : ''} cpm
              </div>
              <div style={{ opacity: 0.55, fontSize: '0.75em' }}>
                {a.tokensUsed.toLocaleString()} tokens
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline({ samples }: { samples: RateSample[] }): ReactElement {
  const buckets = useMemo(() => bucketSamples(samples, { bucketMs: 5_000, buckets: 36 }), [samples]);
  const max = Math.max(1, ...buckets);
  const width = 240;
  const height = 32;
  const step = width / Math.max(1, buckets.length - 1);
  const points = buckets
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} style={{ flex: 1, maxWidth: width }}>
      <polyline
        fill="none"
        stroke="var(--vscode-charts-blue, #3794ff)"
        strokeWidth={1.5}
        points={points}
      />
    </svg>
  );
}

function SessionHistory({ sessions }: { sessions: SessionSummary[] }): ReactElement {
  if (sessions.length === 0) return <div style={emptyStyle}>No sessions recorded yet.</div>;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Session</th>
          <th style={thStyle}>Started</th>
          <th style={thStyle}>Ended</th>
          <th style={thStyle}>Status</th>
          <th style={thStyle}>Agents</th>
          <th style={thStyle}>Tool calls</th>
          <th style={thStyle}>Blocked</th>
          <th style={thStyle} />
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.session_id} style={{ borderBottom: '1px solid var(--vscode-panel-border, #222)' }}>
            <td style={tdStyle}>
              <div style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: '0.85em' }}>{s.session_id}</div>
            </td>
            <td style={tdStyle}>{formatDateTime(s.startedAt)}</td>
            <td style={{ ...tdStyle, opacity: 0.75 }}>{s.endedAt ? formatDateTime(s.endedAt) : '—'}</td>
            <td style={tdStyle}>
              <span style={{ color: s.status === 'killed' ? 'var(--vscode-errorForeground, #f48771)' : s.status === 'running' ? 'var(--vscode-terminal-ansiGreen, #4ec9b0)' : 'inherit' }}>
                {s.status}
              </span>
            </td>
            <td style={tdStyle}>{s.agent_ids.length}</td>
            <td style={tdStyle}>{s.tool_calls}</td>
            <td style={{ ...tdStyle, color: s.blocked_calls > 0 ? 'var(--vscode-editorWarning-foreground, #cca700)' : 'inherit' }}>
              {s.blocked_calls}
            </td>
            <td style={tdStyle}>
              {s.status === 'running' ? (
                <span style={{ opacity: 0.5, fontSize: '0.8em' }}>current</span>
              ) : (
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => postToHost({ type: 'governance.session.load', payload: { session_id: s.session_id } })}
                >
                  Open
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
}): ReactElement {
  const allSelected = value.length === 0;
  return (
    <details style={{ position: 'relative' }}>
      <summary style={{ ...selectStyle, cursor: 'pointer', listStyle: 'none' }}>
        {label}: {allSelected ? 'all' : `${value.length}`}
      </summary>
      <div style={popoverStyle}>
        {options.length === 0 ? (
          <div style={{ opacity: 0.5 }}>(none yet)</div>
        ) : (
          options.map((opt) => (
            <label key={opt} style={{ display: 'flex', gap: '0.5rem', padding: '0.1rem 0' }}>
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={(e) => {
                  if (e.target.checked) onChange([...value, opt]);
                  else onChange(value.filter((v) => v !== opt));
                }}
              />
              <span>{opt}</span>
            </label>
          ))
        )}
        {value.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            style={{ ...buttonStyle, marginTop: '0.5rem', width: '100%' }}
          >
            Clear
          </button>
        ) : null}
      </div>
    </details>
  );
}

function PendingGates({
  gates,
  agents,
}: {
  gates: PendingGate[];
  agents: GovernanceAgentView[];
}): ReactElement {
  const agentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

  if (gates.length === 0) {
    return (
      <div style={emptyStyle}>
        No pending gates. When a policy flags a tool call as <em>requires_approval</em> or{' '}
        <em>requires_input</em>, the agent will pause here awaiting your decision.
      </div>
    );
  }

  const sorted = [...gates].sort((a, b) => (a.requested_at < b.requested_at ? -1 : 1));

  return (
    <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
      <div style={{ opacity: 0.7, fontSize: '0.85em' }}>
        {gates.length} agent{gates.length === 1 ? '' : 's'} paused awaiting a human decision.
      </div>
      {sorted.map((g) => (
        <GateCard key={g.id} gate={g} agentName={agentName.get(g.agent_id) ?? g.agent_id} />
      ))}
    </div>
  );
}

function GateCard({
  gate,
  agentName,
}: {
  gate: PendingGate;
  agentName: string;
}): ReactElement {
  const [argsText, setArgsText] = useState(() => JSON.stringify(gate.args, null, 2));
  const [editing, setEditing] = useState(gate.gate === 'input');
  const [reason, setReason] = useState('');
  const [parseError, setParseError] = useState<string | undefined>(undefined);

  const gateColor =
    gate.gate === 'input'
      ? 'var(--vscode-editorWarning-foreground, #cca700)'
      : 'var(--vscode-terminal-ansiBlue, #5a9bd4)';

  const approve = (): void => {
    let parsedArgs: Record<string, unknown> | undefined;
    if (editing) {
      try {
        const raw = JSON.parse(argsText);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          setParseError('Arguments must be a JSON object.');
          return;
        }
        parsedArgs = raw as Record<string, unknown>;
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setParseError(undefined);
    postToHost({
      type: 'governance.gate.decide',
      payload: {
        id: gate.id,
        outcome: 'approve',
        args: parsedArgs,
        reason: reason || undefined,
      },
    });
  };

  const reject = (): void => {
    postToHost({
      type: 'governance.gate.decide',
      payload: {
        id: gate.id,
        outcome: 'reject',
        reason: reason || undefined,
      },
    });
  };

  return (
    <div
      style={{
        border: '1px solid var(--vscode-panel-border, #333)',
        borderLeft: `3px solid ${gateColor}`,
        borderRadius: 4,
        padding: '0.75rem',
        background: 'var(--vscode-editorWidget-background, #252526)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
        <strong>{agentName}</strong>
        <span style={{ opacity: 0.6, fontSize: '0.8em', fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
          {gate.agent_id}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: '0.75em',
            padding: '0.1rem 0.45rem',
            borderRadius: 3,
            background: gateColor,
            color: 'var(--vscode-editor-background, #1e1e1e)',
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          {gate.gate === 'input' ? 'require_input' : 'require_approval'}
        </span>
      </div>

      <div style={{ fontSize: '0.9em' }}>
        wants to call{' '}
        <code style={{ background: 'var(--vscode-textCodeBlock-background, #1a1a1a)', padding: '0.05rem 0.3rem', borderRadius: 2 }}>
          {gate.mcp_name ?? gate.mcp_id}::{gate.tool_name}
        </code>
      </div>

      {gate.reason ? (
        <div style={{ opacity: 0.7, fontSize: '0.8em' }}>Policy reason: {gate.reason}</div>
      ) : null}

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span style={{ fontSize: '0.8em', opacity: 0.75 }}>Arguments</span>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            style={{ ...rowButtonStyle, fontSize: '0.75em' }}
          >
            {editing ? 'Lock' : 'Edit'}
          </button>
        </div>
        {editing ? (
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            style={{
              ...textareaStyle,
              minHeight: '6rem',
              fontFamily: 'var(--vscode-editor-font-family, monospace)',
              fontSize: '0.85em',
            }}
          />
        ) : (
          <pre style={{ ...preStyle, margin: 0, maxHeight: '12rem', overflowY: 'auto' }}>{argsText}</pre>
        )}
        {parseError ? (
          <div style={{ color: 'var(--vscode-errorForeground, #f48771)', fontSize: '0.8em', marginTop: '0.25rem' }}>
            {parseError}
          </div>
        ) : null}
      </div>

      <div>
        <label style={{ ...labelStyle, marginBottom: '0.25rem' }}>Reason (optional)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={inputStyle}
          placeholder="Added to the audit log"
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={reject} style={killButtonStyle}>
          Reject
        </button>
        <button type="button" onClick={approve} style={buttonPrimaryStyle}>
          Approve{editing ? ' with edited args' : ''}
        </button>
      </div>

      <div style={{ fontSize: '0.72em', opacity: 0.5, textAlign: 'right' }}>
        requested {formatRelativeTime(gate.requested_at)} · tool_call_id {gate.tool_call_id}
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < 5000) return 'just now';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return new Date(then).toLocaleTimeString();
}

function IamMatrix({
  agents,
  policy,
  catalog,
}: {
  agents: GovernanceAgentView[];
  policy: GovernancePolicy;
  catalog: ToolCatalogEntry[];
}): ReactElement {
  const [scope, setScope] = useState<'matrix' | 'platform'>('matrix');

  if (agents.length === 0) {
    return (
      <div style={emptyStyle}>
        No agents onboarded yet. Run <code>Ujima: Onboard New Agent</code> to populate the matrix.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          padding: '0.4rem 0.75rem',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          alignItems: 'baseline',
        }}
      >
        <button
          type="button"
          style={scope === 'matrix' ? tabActiveStyle : tabStyle}
          onClick={() => setScope('matrix')}
        >
          Agent × Tool
        </button>
        <button
          type="button"
          style={scope === 'platform' ? tabActiveStyle : tabStyle}
          onClick={() => setScope('platform')}
        >
          Platform rules
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ opacity: 0.55, fontSize: '0.75em' }}>
          click any chip to cycle allow → approve → input → deny → inherit.
          platform always-deny overrides agent rules.
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {scope === 'matrix' ? (
          <MatrixGrid agents={agents} policy={policy} catalog={catalog} />
        ) : (
          <PlatformRules policy={policy} catalog={catalog} />
        )}
      </div>
    </div>
  );
}

function MatrixGrid({
  agents,
  policy,
  catalog,
}: {
  agents: GovernanceAgentView[];
  policy: GovernancePolicy;
  catalog: ToolCatalogEntry[];
}): ReactElement {
  const grouped = useMemo(() => groupCatalog(catalog), [catalog]);

  if (catalog.length === 0) {
    return (
      <div style={emptyStyle}>
        No tools discovered yet. Run a task so Ujima can spawn the MCPs and populate their tool
        lists. Destructive tools from the registry show up immediately.
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0.75rem' }}>
      {grouped.map((group) => (
        <div key={group.mcp_id} style={{ marginBottom: '1rem' }}>
          <div style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--vscode-panel-border, #333)', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
            <strong>{group.mcp_name}</strong>
            <span style={{ opacity: 0.55, fontSize: '0.8em', fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
              {group.mcp_id}
            </span>
            <span style={{ opacity: 0.45, fontSize: '0.8em' }}>{group.tools.length} tools</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...tableStyle, minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, position: 'sticky', left: 0, background: 'var(--vscode-editor-background)' }}>Tool</th>
                  {agents.map((a) => (
                    <th key={a.id} style={thStyle}>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ opacity: 0.5, fontSize: '0.75em' }}>{a.mcp}</div>
                    </th>
                  ))}
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {group.tools.map((tool) => (
                  <tr key={tool.tool_name} style={{ borderBottom: '1px solid var(--vscode-panel-border, #222)' }}>
                    <td
                      style={{
                        ...tdStyle,
                        position: 'sticky',
                        left: 0,
                        background: 'var(--vscode-editor-background)',
                        minWidth: 200,
                      }}
                    >
                      <div style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
                        {tool.tool_name}
                        {tool.destructive ? (
                          <span
                            style={{
                              marginLeft: 6,
                              padding: '0 4px',
                              borderRadius: 3,
                              background: 'var(--vscode-inputValidation-warningBackground, #4b3a00)',
                              color: 'var(--vscode-editorWarning-foreground, #cca700)',
                              fontSize: '0.7em',
                            }}
                          >
                            destructive
                          </span>
                        ) : null}
                      </div>
                      {tool.description ? (
                        <div style={{ opacity: 0.5, fontSize: '0.75em' }}>{tool.description.slice(0, 80)}</div>
                      ) : null}
                    </td>
                    {agents.map((a) => (
                      <td key={a.id} style={{ ...tdStyle, padding: '0.25rem 0.5rem' }}>
                        <PolicyChip
                          agent={a}
                          mcpId={tool.mcp_id}
                          toolName={tool.tool_name}
                          policy={policy}
                        />
                      </td>
                    ))}
                    <td style={tdStyle} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div
        style={{
          marginTop: '0.75rem',
          padding: '0.5rem 0.75rem',
          border: '1px solid var(--vscode-panel-border, #333)',
          borderRadius: 4,
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ opacity: 0.7 }}>Quick actions:</span>
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            style={killButtonStyle}
            onClick={() => {
              if (!window.confirm(`Revoke all tool access for ${a.name} (${a.id})?`)) return;
              postToHost({
                type: 'governance.policy.update',
                payload: { op: 'quickRevoke', agent_id: a.id },
              });
            }}
          >
            Revoke {a.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function PolicyChip({
  agent,
  mcpId,
  toolName,
  policy,
}: {
  agent: GovernanceAgentView;
  mcpId: string;
  toolName: string;
  policy: GovernancePolicy;
}): ReactElement {
  const evalResult = evaluatePolicy(policy, {
    agentId: agent.id,
    mcpId,
    toolName,
  });
  const explicit = findExplicitAgentRule(policy, agent.id, mcpId, toolName);
  const state: ToolPolicyState = explicit?.state ?? 'inherit';
  const inheritedFrom = !explicit && evalResult.state !== 'inherit' ? evalResult.source : undefined;

  const cycle = (): void => {
    const idx = POLICY_CYCLE.indexOf(state);
    const next = POLICY_CYCLE[(idx + 1) % POLICY_CYCLE.length] ?? 'inherit';
    if (next === 'inherit') {
      postToHost({
        type: 'governance.policy.update',
        payload: {
          op: 'removeAgent',
          agent_id: agent.id,
          mcp_id: mcpId,
          tool_name: toolName,
        },
      });
      return;
    }
    const rule: ToolPolicyRule = { mcp_id: mcpId, tool_name: toolName, state: next };
    postToHost({
      type: 'governance.policy.update',
      payload: { op: 'setAgent', agent_id: agent.id, rule },
    });
  };

  const color = chipColor(state);
  const title = [
    `current: ${STATE_LABELS[state]}`,
    inheritedFrom ? `effective: ${STATE_LABELS[evalResult.state]} (from ${inheritedFrom})` : null,
    explicit?.reason ? `reason: ${explicit.reason}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <button
      type="button"
      onClick={cycle}
      title={title}
      style={{
        padding: '0.15rem 0.55rem',
        borderRadius: 12,
        border: `1px solid ${color.border}`,
        background: color.bg,
        color: color.fg,
        fontSize: '0.75em',
        cursor: 'pointer',
        minWidth: 72,
        opacity: inheritedFrom ? 0.75 : 1,
      }}
    >
      {STATE_LABELS[state]}
      {inheritedFrom ? '*' : ''}
    </button>
  );
}

function PlatformRules({
  policy,
  catalog,
}: {
  policy: GovernancePolicy;
  catalog: ToolCatalogEntry[];
}): ReactElement {
  const mcpOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const c of catalog) ids.add(c.mcp_id);
    for (const r of policy.platform.always_deny) ids.add(r.mcp_id);
    for (const r of policy.platform.default_require_approval) ids.add(r.mcp_id);
    return ['*', ...[...ids].sort()];
  }, [catalog, policy]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.75rem 1rem' }}>
      <PlatformBucket
        bucket="always_deny"
        title="Kill-switch (always deny)"
        hint="Hard platform veto. Applies to every agent and overrides agent rules. Use for tools that must never run in this workspace."
        rules={policy.platform.always_deny}
        mcpOptions={mcpOptions}
      />
      <PlatformBucket
        bucket="default_require_approval"
        title="Default require-approval"
        hint="Applies when no agent rule says otherwise. Use for destructive tools you want a human to sign off on by default."
        rules={policy.platform.default_require_approval}
        mcpOptions={mcpOptions}
      />
    </div>
  );
}

function PlatformBucket({
  bucket,
  title,
  hint,
  rules,
  mcpOptions,
}: {
  bucket: 'always_deny' | 'default_require_approval';
  title: string;
  hint: string;
  rules: ToolPolicyRule[];
  mcpOptions: string[];
}): ReactElement {
  const [mcpId, setMcpId] = useState(mcpOptions[0] ?? '*');
  const [toolName, setToolName] = useState('*');
  const [reason, setReason] = useState('');

  const add = (): void => {
    if (!toolName.trim()) return;
    postToHost({
      type: 'governance.policy.update',
      payload: {
        op: 'setPlatform',
        bucket,
        rule: {
          mcp_id: mcpId,
          tool_name: toolName.trim(),
          state: bucket === 'always_deny' ? 'deny' : 'require_approval',
          reason: reason.trim() || undefined,
        },
      },
    });
    setToolName('*');
    setReason('');
  };

  return (
    <section style={{ border: '1px solid var(--vscode-panel-border, #333)', borderRadius: 4 }}>
      <header
        style={{
          padding: '0.5rem 0.75rem',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          background: 'var(--vscode-editorWidget-background, #252526)',
        }}
      >
        <strong>{title}</strong>
        <div style={{ opacity: 0.6, fontSize: '0.8em', marginTop: 2 }}>{hint}</div>
      </header>
      <div style={{ padding: '0.5rem 0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>MCP</span>
          <select value={mcpId} onChange={(e) => setMcpId(e.target.value)} style={selectStyle}>
            {mcpOptions.map((id) => (
              <option key={id} value={id}>
                {id === '*' ? '* (all MCPs)' : id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelStyle}>Tool name (use * or prefix*)</span>
          <input
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            placeholder="delete_*"
            style={{ ...inputStyle, minWidth: 160 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 200 }}>
          <span style={labelStyle}>Reason (shown in denials)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this rule exists"
            style={inputStyle}
          />
        </label>
        <button type="button" onClick={add} style={buttonPrimaryStyle}>
          Add rule
        </button>
      </div>
      {rules.length === 0 ? (
        <div style={{ padding: '0.5rem 0.75rem', opacity: 0.55, fontSize: '0.85em' }}>
          No rules in this bucket yet.
        </div>
      ) : (
        <table style={{ ...tableStyle, marginTop: 0 }}>
          <thead>
            <tr>
              <th style={thStyle}>MCP</th>
              <th style={thStyle}>Tool</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>Updated</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={`${r.mcp_id}:${r.tool_name}`} style={{ borderBottom: '1px solid var(--vscode-panel-border, #222)' }}>
                <td style={tdStyle}>{r.mcp_id}</td>
                <td style={tdStyle}>
                  <code>{r.tool_name}</code>
                </td>
                <td style={{ ...tdStyle, opacity: 0.75 }}>{r.reason ?? '—'}</td>
                <td style={{ ...tdStyle, opacity: 0.55, fontSize: '0.8em' }}>{r.updated_at ?? '—'}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    style={buttonStyle}
                    onClick={() =>
                      postToHost({
                        type: 'governance.policy.update',
                        payload: {
                          op: 'removePlatform',
                          bucket,
                          mcp_id: r.mcp_id,
                          tool_name: r.tool_name,
                        },
                      })
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface GroupedCatalog {
  mcp_id: string;
  mcp_name: string;
  tools: ToolCatalogEntry[];
}

function groupCatalog(catalog: ToolCatalogEntry[]): GroupedCatalog[] {
  const byMcp = new Map<string, GroupedCatalog>();
  for (const entry of catalog) {
    let group = byMcp.get(entry.mcp_id);
    if (!group) {
      group = { mcp_id: entry.mcp_id, mcp_name: entry.mcp_name, tools: [] };
      byMcp.set(entry.mcp_id, group);
    }
    group.tools.push(entry);
  }
  return [...byMcp.values()].sort((a, b) => a.mcp_id.localeCompare(b.mcp_id));
}

function findExplicitAgentRule(
  policy: GovernancePolicy,
  agentId: string,
  mcpId: string,
  toolName: string,
): ToolPolicyRule | undefined {
  const rules = policy.agents[agentId] ?? [];
  return rules.find((r) => r.mcp_id === mcpId && r.tool_name === toolName);
}

function chipColor(state: ToolPolicyState): { bg: string; fg: string; border: string } {
  switch (state) {
    case 'allow':
      return {
        bg: 'rgba(78, 201, 176, 0.15)',
        fg: 'var(--vscode-terminal-ansiGreen, #4ec9b0)',
        border: 'var(--vscode-terminal-ansiGreen, #4ec9b0)',
      };
    case 'deny':
      return {
        bg: 'rgba(244, 135, 113, 0.18)',
        fg: 'var(--vscode-errorForeground, #f48771)',
        border: 'var(--vscode-errorForeground, #f48771)',
      };
    case 'require_approval':
      return {
        bg: 'rgba(204, 167, 0, 0.18)',
        fg: 'var(--vscode-editorWarning-foreground, #cca700)',
        border: 'var(--vscode-editorWarning-foreground, #cca700)',
      };
    case 'require_input':
      return {
        bg: 'rgba(55, 148, 255, 0.18)',
        fg: 'var(--vscode-charts-blue, #3794ff)',
        border: 'var(--vscode-charts-blue, #3794ff)',
      };
    case 'inherit':
    default:
      return {
        bg: 'transparent',
        fg: 'var(--vscode-descriptionForeground, #aaa)',
        border: 'var(--vscode-panel-border, #444)',
      };
  }
}

function parseList(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 8);
  return new Date(t).toISOString().slice(11, 19);
}

function formatDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19);
}

function summarizeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 120);
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return String(value);
  }
}

function statusColor(status: GovernanceAgentView['status']): string {
  switch (status) {
    case 'active':
      return 'var(--vscode-terminal-ansiGreen, #4ec9b0)';
    case 'blocked':
    case 'killed':
      return 'var(--vscode-errorForeground, #f48771)';
    case 'waiting':
      return 'var(--vscode-editorWarning-foreground, #cca700)';
    case 'exited':
      return 'var(--vscode-descriptionForeground, #aaa)';
    default:
      return 'inherit';
  }
}

function pctColor(pct: number): string {
  if (pct >= 90) return 'var(--vscode-errorForeground, #f48771)';
  if (pct >= 70) return 'var(--vscode-editorWarning-foreground, #cca700)';
  return 'var(--vscode-terminal-ansiGreen, #4ec9b0)';
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  color: 'var(--vscode-foreground)',
  background: 'var(--vscode-editor-background)',
  fontFamily: 'system-ui, sans-serif',
};

const headerStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--vscode-panel-border, #333)',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const tabStyle: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  background: 'transparent',
  color: 'var(--vscode-foreground)',
  border: '1px solid transparent',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: '0.85em',
};

const tabActiveStyle: React.CSSProperties = {
  ...tabStyle,
  background: 'var(--vscode-editorWidget-background, #252526)',
  border: '1px solid var(--vscode-panel-border, #333)',
};

const tabBadgeStyle: React.CSSProperties = {
  marginLeft: '0.35rem',
  padding: '0 0.35rem',
  borderRadius: 8,
  fontSize: '0.75em',
  background: 'var(--vscode-editorWarning-foreground, #cca700)',
  color: 'var(--vscode-editor-background, #1e1e1e)',
  fontWeight: 600,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.88em',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4rem 0.75rem',
  fontWeight: 600,
  borderBottom: '1px solid var(--vscode-panel-border, #333)',
  opacity: 0.75,
};

const tdStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  verticalAlign: 'top',
};

const emptyStyle: React.CSSProperties = {
  padding: '2rem',
  textAlign: 'center',
  opacity: 0.6,
};

const inputStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  background: 'var(--vscode-input-background, #3c3c3c)',
  color: 'var(--vscode-input-foreground, #ccc)',
  border: '1px solid var(--vscode-input-border, transparent)',
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: '0.9em',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--vscode-editor-font-family, ui-monospace, monospace)',
  resize: 'vertical',
};

const labelStyle: React.CSSProperties = {
  opacity: 0.7,
  fontSize: '0.8em',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const buttonStyle: React.CSSProperties = {
  padding: '0.3rem 0.7rem',
  background: 'var(--vscode-button-secondaryBackground, #3a3a3a)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: '1px solid var(--vscode-panel-border, transparent)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: '0.85em',
};

const buttonPrimaryStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--vscode-button-background, #0e639c)',
  color: 'var(--vscode-button-foreground, #fff)',
};

const killButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--vscode-errorForeground, #f48771)',
  color: '#fff',
  fontWeight: 600,
};

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 10,
  marginTop: 4,
  padding: '0.5rem',
  minWidth: 160,
  background: 'var(--vscode-editorWidget-background, #252526)',
  border: '1px solid var(--vscode-panel-border, #333)',
  borderRadius: 4,
  maxHeight: 240,
  overflowY: 'auto',
};

const rowButtonStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  gap: '0.5rem',
  width: '100%',
  alignItems: 'baseline',
};

const preStyle: React.CSSProperties = {
  margin: '0.4rem 0 0 0',
  padding: '0.5rem',
  background: 'var(--vscode-editorWidget-background, rgba(255,255,255,0.04))',
  borderRadius: 4,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: '0.85em',
};

const sidebarItem: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  display: 'block',
  padding: '0.5rem 0.75rem',
  width: '100%',
  boxSizing: 'border-box',
  borderBottom: '1px solid var(--vscode-panel-border, #222)',
};

const sidebarItemActive: React.CSSProperties = {
  ...sidebarItem,
  background: 'var(--vscode-list-activeSelectionBackground, #094771)',
  color: 'var(--vscode-list-activeSelectionForeground, #fff)',
};
