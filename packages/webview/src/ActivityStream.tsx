import { useMemo, useState, type ReactElement } from 'react';
import {
  filterActivity,
  uniqueAgents,
  uniqueTypes,
  type ActivityEvent,
  type ActivityFilter,
} from '@ujima/shared';

export interface ActivityStreamProps {
  events: ActivityEvent[];
}

const TIME_WINDOWS: { label: string; ms?: number }[] = [
  { label: 'All time' },
  { label: 'Last 1m', ms: 60_000 },
  { label: 'Last 5m', ms: 5 * 60_000 },
  { label: 'Last 15m', ms: 15 * 60_000 },
  { label: 'Last 1h', ms: 60 * 60_000 },
];

export function ActivityStream({ events }: ActivityStreamProps): ReactElement {
  const [agents, setAgents] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [windowMs, setWindowMs] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');

  const availableAgents = useMemo(() => uniqueAgents(events), [events]);
  const availableTypes = useMemo(() => uniqueTypes(events), [events]);

  const filter: ActivityFilter = useMemo(
    () => ({
      agents,
      types,
      sinceMs: windowMs ? Date.now() - windowMs : undefined,
      search: search.trim() || undefined,
    }),
    [agents, types, windowMs, search],
  );

  const visible = useMemo(() => filterActivity(events, filter), [events, filter]);

  return (
    <section
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--vscode-foreground)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <header
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--vscode-panel-border, #333)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
          <strong>Activity Stream</strong>
          <span style={{ opacity: 0.6, fontSize: '0.85em' }}>
            {visible.length} / {events.length} events
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <MultiSelect
            label="Agent"
            options={availableAgents}
            value={agents}
            onChange={setAgents}
          />
          <MultiSelect label="Type" options={availableTypes} value={types} onChange={setTypes} />
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
            placeholder="Search payload, id, task…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          />
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {visible.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', opacity: 0.6 }}>
            {events.length === 0 ? 'Waiting for events…' : 'No events match the current filters.'}
          </div>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {visible.map((e) => (
              <EventRow key={e.event_id} event={e} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function EventRow({ event }: { event: ActivityEvent }): ReactElement {
  const [open, setOpen] = useState(false);
  const time = formatTime(event.timestamp);
  return (
    <li
      style={{
        borderBottom: '1px solid var(--vscode-panel-border, #222)',
        padding: '0.5rem 1rem',
        fontFamily: 'var(--vscode-editor-font-family, ui-monospace, monospace)',
        fontSize: '0.85em',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          gap: '0.5rem',
          width: '100%',
          alignItems: 'baseline',
        }}
      >
        <span style={{ opacity: 0.5, minWidth: 80 }}>{time}</span>
        <span style={{ color: typeColor(event.type), minWidth: 140 }}>{event.type}</span>
        <span style={{ opacity: 0.85, minWidth: 120 }}>{event.publisher}</span>
        <span style={{ opacity: 0.5, flex: 1 }}>{summarizePayload(event.payload)}</span>
        <span style={{ opacity: 0.4 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <pre
          style={{
            margin: '0.5rem 0 0 0',
            padding: '0.5rem',
            background: 'var(--vscode-editorWidget-background, rgba(255,255,255,0.04))',
            borderRadius: 4,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {JSON.stringify(
            {
              event_id: event.event_id,
              task_id: event.task_id,
              session_id: event.session_id,
              payload: event.payload,
            },
            null,
            2,
          )}
        </pre>
      ) : null}
    </li>
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
        {label}: {allSelected ? 'all' : `${value.length} selected`}
      </summary>
      <div
        style={{
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
        }}
      >
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
            style={{ ...inputStyle, marginTop: '0.5rem', width: '100%' }}
          >
            Clear
          </button>
        ) : null}
      </div>
    </details>
  );
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 8);
  const d = new Date(t);
  return d.toISOString().slice(11, 19);
}

function summarizePayload(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload.slice(0, 160);
  try {
    const s = JSON.stringify(payload);
    return s.length > 160 ? `${s.slice(0, 157)}…` : s;
  } catch {
    return String(payload);
  }
}

function typeColor(type: string): string {
  if (type.includes('error') || type.includes('fail')) return 'var(--vscode-errorForeground, #f48771)';
  if (type.includes('approval') || type.includes('review')) {
    return 'var(--vscode-editorWarning-foreground, #cca700)';
  }
  if (type.includes('started') || type.includes('completed')) {
    return 'var(--vscode-terminal-ansiGreen, #4ec9b0)';
  }
  return 'var(--vscode-textLink-foreground, #3794ff)';
}

const inputStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  background: 'var(--vscode-input-background, #3c3c3c)',
  color: 'var(--vscode-input-foreground, #ccc)',
  border: '1px solid var(--vscode-input-border, transparent)',
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: '0.9em',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};
