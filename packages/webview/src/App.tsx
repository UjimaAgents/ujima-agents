import type { ReactElement } from 'react';
import { UJIMA_VERSION } from '@ujima/shared';
import { ActivityStream } from './ActivityStream';
import { Governance } from './Governance';
import { useHostEvents } from './host-bridge';

export function App(): ReactElement {
  const view = typeof window !== 'undefined' ? window.__UJIMA_VIEW__ : undefined;
  if (view === 'governance') {
    return <Governance />;
  }
  return <ActivityStreamView />;
}

function ActivityStreamView(): ReactElement {
  const events = useHostEvents();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        color: 'var(--vscode-foreground)',
        background: 'var(--vscode-editor-background)',
      }}
    >
      <div style={{ padding: '0.4rem 1rem', opacity: 0.55, fontSize: '0.75em' }}>
        Ujima v{UJIMA_VERSION}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ActivityStream events={events} />
      </div>
    </div>
  );
}
