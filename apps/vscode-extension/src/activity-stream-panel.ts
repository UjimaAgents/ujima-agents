import * as vscode from 'vscode';
import type { ActivityEvent, HostToWebviewMessage, WebviewToHostMessage } from '@ujima/shared';
import { renderWebviewHtml, resolveWebviewDist, webviewFallbackHtml } from './webview-host';

export interface ActivityStreamPanelOptions {
  extensionUri: vscode.Uri;
  channel: vscode.OutputChannel;
  initialEvents?: ActivityEvent[];
  onWebviewMessage?: (msg: WebviewToHostMessage) => void;
}

export class ActivityStreamPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly buffer: ActivityEvent[] = [];
  private webviewReady = false;
  private readonly opts: ActivityStreamPanelOptions;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(opts: ActivityStreamPanelOptions) {
    this.opts = opts;
    if (opts.initialEvents?.length) this.buffer.push(...opts.initialEvents);
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const webviewDist = resolveWebviewDist(this.opts.extensionUri);
    this.panel = vscode.window.createWebviewPanel(
      'ujima.activityStream',
      'Ujima — Activity Stream',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewDist],
      },
    );

    try {
      this.panel.webview.html = renderWebviewHtml({
        webview: this.panel.webview,
        webviewDist,
        globals: { __UJIMA_VIEW__: 'activity' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.html = webviewFallbackHtml(message);
      this.opts.channel.appendLine(`[activity] webview render failed: ${message}`);
    }

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) => {
        const msg = raw as WebviewToHostMessage;
        if (msg?.type === 'ready') {
          this.webviewReady = true;
          void this.flush();
          return;
        }
        this.opts.onWebviewMessage?.(msg);
      }),
      this.panel.onDidDispose(() => {
        this.webviewReady = false;
        this.panel = undefined;
        for (const d of this.disposables.splice(0)) d.dispose();
      }),
    );
  }

  pushEvents(events: ActivityEvent[]): void {
    if (events.length === 0) return;
    this.buffer.push(...events);
    if (this.panel && this.webviewReady) {
      void this.post({ type: 'events.appended', payload: { events } });
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    await this.post({ type: 'events.appended', payload: { events: this.buffer.slice() } });
  }

  private async post(msg: HostToWebviewMessage): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage(msg);
  }

}

export function toActivityEvent(event: {
  event_id: string;
  type: string;
  publisher: string;
  timestamp: string;
  task_id?: string;
  session_id?: string;
  payload?: unknown;
}): ActivityEvent {
  return {
    event_id: event.event_id,
    type: event.type,
    publisher: event.publisher,
    timestamp: event.timestamp,
    task_id: event.task_id,
    session_id: event.session_id,
    payload: event.payload,
  };
}

