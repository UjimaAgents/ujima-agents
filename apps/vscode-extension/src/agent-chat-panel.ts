import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { UjimaEvent } from '@ujima/shared';

interface ChatEventMsg {
  type: 'stream';
  event: {
    event_id: string;
    type: string;
    publisher: string;
    timestamp: string;
    task_id?: string;
    payload: unknown;
  };
}

interface TaskStartedMsg {
  type: 'task.started';
  taskId: string;
  prompt: string;
  agentIds: string[];
}

interface TaskEndedMsg {
  type: 'task.ended';
  taskId: string;
  status: string;
  error?: string;
}

interface ResetMsg {
  type: 'reset';
}

interface ApprovalRequestedMsg {
  type: 'approval.requested';
  approvalId: string;
  taskId: string;
  artifactKey: string;
  domain: string;
  proposedBy: string;
  summary?: string;
}

interface ApprovalDecidedMsg {
  type: 'approval.decided';
  approvalId: string;
  decision: 'approved' | 'rejected';
}

type HostToChat = ChatEventMsg | TaskStartedMsg | TaskEndedMsg | ResetMsg | ApprovalRequestedMsg | ApprovalDecidedMsg;

interface BufferedMsg {
  msg: HostToChat;
}

export interface ChatPanelCallbacks {
  onSubmitTask?: (prompt: string, mode?: 'auto' | 'manual') => void;
  onApprovalDecision?: (approvalId: string, decision: 'approved' | 'rejected', reason?: string) => void;
  onRetryTask?: (taskId: string) => void;
  onCancelAgent?: (agentId: string) => void;
}

export class AgentChatPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private readonly buffer: BufferedMsg[] = [];
  private readonly channel: vscode.OutputChannel;
  private callbacks: ChatPanelCallbacks = {};

  constructor(opts: { channel: vscode.OutputChannel }) {
    this.channel = opts.channel;
  }

  setCallbacks(cb: ChatPanelCallbacks): void {
    this.callbacks = cb;
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'ujima.agentChat',
      'Ujima — Agent Chat',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = renderHtml();
    this.panel.webview.onDidReceiveMessage((m: unknown) => {
      if (!m || typeof m !== 'object') return;
      const msg = m as {
        type?: string;
        prompt?: string;
        mode?: string;
        approvalId?: string;
        decision?: string;
        reason?: string;
        taskId?: string;
        agentId?: string;
      };
      if (msg.type === 'ready') {
        this.ready = true;
        for (const { msg: buffered } of this.buffer.splice(0)) this.post(buffered);
      } else if (msg.type === 'task.submit' && msg.prompt) {
        this.callbacks.onSubmitTask?.(msg.prompt, msg.mode as 'auto' | 'manual' | undefined);
      } else if (msg.type === 'task.retry' && msg.prompt) {
        this.callbacks.onRetryTask?.(msg.taskId ?? '');
        this.callbacks.onSubmitTask?.(msg.prompt, msg.mode as 'auto' | 'manual' | undefined);
      } else if (msg.type === 'agent.cancel' && msg.agentId) {
        this.callbacks.onCancelAgent?.(msg.agentId);
      } else if (msg.type === 'approval.decide' && msg.approvalId && msg.decision) {
        this.callbacks.onApprovalDecision?.(
          msg.approvalId,
          msg.decision as 'approved' | 'rejected',
          msg.reason,
        );
      }
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
    });
  }

  onTaskStarted(taskId: string, prompt: string, agentIds: string[]): void {
    this.send({ type: 'task.started', taskId, prompt, agentIds });
  }

  onTaskEnded(taskId: string, status: string, error?: string): void {
    this.send({ type: 'task.ended', taskId, status, error });
  }

  onApprovalRequested(input: {
    approvalId: string;
    taskId: string;
    artifactKey: string;
    domain: string;
    proposedBy: string;
    summary?: string;
  }): void {
    this.send({
      type: 'approval.requested',
      approvalId: input.approvalId,
      taskId: input.taskId,
      artifactKey: input.artifactKey,
      domain: input.domain,
      proposedBy: input.proposedBy,
      summary: input.summary,
    });
  }

  onApprovalDecided(approvalId: string, decision: 'approved' | 'rejected'): void {
    this.send({ type: 'approval.decided', approvalId, decision });
  }

  onStreamEvent(event: UjimaEvent): void {
    this.send({
      type: 'stream',
      event: {
        event_id: event.event_id,
        type: event.type,
        publisher: event.publisher,
        timestamp: event.timestamp,
        task_id: event.task_id,
        payload: event.payload,
      },
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private send(msg: HostToChat): void {
    if (this.ready && this.panel) {
      this.post(msg);
      return;
    }
    this.buffer.push({ msg });
    if (this.buffer.length > 5000) this.buffer.splice(0, this.buffer.length - 5000);
    if (!this.panel) this.reveal();
  }

  private post(msg: HostToChat): void {
    this.panel?.webview.postMessage(msg).then(undefined, (err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.channel.appendLine(`[chat] post failed: ${message}`);
    });
  }
}

function renderHtml(): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    `default-src 'none'`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  :root { color-scheme: var(--vscode-colorScheme); }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
  header { padding: .75rem 1rem; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  header h2 { margin: 0; font-size: .95rem; font-weight: 600; }
  header .meta { font-size: .75rem; opacity: .7; }
  #log { flex: 1; overflow-y: auto; padding: 1rem; scroll-behavior: smooth; }
  .task { margin-bottom: 1.75rem; }
  .task-prompt { padding: .65rem .85rem; background: var(--vscode-editorWidget-background); border-left: 3px solid var(--vscode-focusBorder); margin-bottom: 1rem; font-size: .85rem; border-radius: 0 4px 4px 0; }
  .task-prompt .label { font-size: .7rem; font-weight: 600; text-transform: uppercase; opacity: .65; letter-spacing: .06em; margin-bottom: .2rem; }
  .task-prompt .body { line-height: 1.5; }

  .agent-turn { margin: .75rem 0; display: grid; grid-template-columns: 28px 1fr; gap: .6rem; }
  .avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: .7rem; font-weight: 700; color: #fff; letter-spacing: .02em; flex-shrink: 0; user-select: none; margin-top: 1px; }
  .turn-body { min-width: 0; }
  .turn-head { display: flex; align-items: baseline; gap: .5rem; font-size: .78rem; margin-bottom: .25rem; }
  .turn-head .name { font-weight: 600; opacity: .95; }
  .turn-head .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-charts-blue, #58a6ff); margin-left: .1rem; flex-shrink: 0; align-self: center; }
  .turn-head .time { opacity: .5; font-size: .7rem; font-variant-numeric: tabular-nums; }
  .agent-turn.done .turn-head .dot { background: var(--vscode-charts-green, #3fb950); }
  .agent-turn.err .turn-head .dot { background: var(--vscode-charts-red, #f85149); }
  .agent-turn.esc .turn-head .dot { background: var(--vscode-charts-yellow, #d29922); }

  .bubble { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 10px; padding: .6rem .8rem; font-size: .88rem; line-height: 1.55; word-break: break-word; }
  .bubble.live::after { content: '▌'; opacity: .6; animation: blink 1s infinite; margin-left: 2px; }
  .bubble.final { background: transparent; border-color: transparent; padding-left: 0; padding-right: 0; }
  .bubble.empty { display: none; }
  .bubble.err { border-color: var(--vscode-charts-red, #f85149); }
  @keyframes blink { 0%, 50% { opacity: .6; } 51%, 100% { opacity: 0; } }

  .bubble p { margin: 0 0 .5rem 0; }
  .bubble p:last-child { margin-bottom: 0; }
  .bubble h1, .bubble h2, .bubble h3 { margin: .7rem 0 .3rem 0; line-height: 1.2; }
  .bubble h1 { font-size: 1.05rem; } .bubble h2 { font-size: 1rem; } .bubble h3 { font-size: .95rem; }
  .bubble ul, .bubble ol { margin: .35rem 0 .5rem 0; padding-left: 1.3rem; }
  .bubble li { margin: .15rem 0; }
  .bubble li > ul, .bubble li > ol { margin: .15rem 0; }
  .bubble a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  .bubble a:hover { text-decoration: underline; }
  .bubble code { background: var(--vscode-textCodeBlock-background); padding: 0 .3rem; border-radius: 3px; font-family: var(--vscode-editor-font-family), monospace; font-size: .83rem; }
  .bubble pre { background: var(--vscode-textCodeBlock-background); padding: .55rem .7rem; border-radius: 4px; overflow-x: auto; font-family: var(--vscode-editor-font-family), monospace; font-size: .8rem; margin: .4rem 0; }
  .bubble pre code { background: transparent; padding: 0; }
  .bubble hr { border: 0; border-top: 1px solid var(--vscode-panel-border); margin: .6rem 0; }
  .bubble strong { font-weight: 600; }
  .bubble em { font-style: italic; }

  details.tool { margin: .4rem 0; border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-size: .8rem; }
  details.tool[open] { background: var(--vscode-editorWidget-background); }
  details.tool > summary { padding: .35rem .6rem; cursor: pointer; list-style: none; display: flex; gap: .5rem; align-items: center; }
  details.tool > summary::-webkit-details-marker { display: none; }
  details.tool .chev { display: inline-block; width: 10px; opacity: .6; }
  details.tool[open] .chev::before { content: '▾'; }
  details.tool:not([open]) .chev::before { content: '▸'; }
  details.tool .tname { font-family: var(--vscode-editor-font-family), monospace; font-weight: 600; }
  details.tool .tmeta { opacity: .6; margin-left: auto; font-size: .7rem; }
  details.tool.err > summary { color: var(--vscode-charts-red, #f85149); }
  details.tool pre { margin: 0; padding: .55rem .7rem; border-top: 1px solid var(--vscode-panel-border); overflow-x: auto; font-size: .75rem; font-family: var(--vscode-editor-font-family), monospace; white-space: pre-wrap; }
  details.tool .res-wrap { position: relative; }
  details.tool .res-clipped { max-height: 16em; overflow: hidden; }
  details.tool .res-toggle { display: inline-block; margin: .4rem .7rem; padding: .15rem .5rem; font-size: .7rem; background: transparent; border: 1px solid var(--vscode-panel-border); border-radius: 3px; color: var(--vscode-textLink-foreground); cursor: pointer; }
  details.tool .res-toggle:hover { background: var(--vscode-list-hoverBackground); }

  .copy-btn { position: absolute; top: .3rem; right: .3rem; padding: .1rem .45rem; font-size: .68rem; background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border); border-radius: 3px; cursor: pointer; opacity: 0; transition: opacity .15s; font-family: var(--vscode-font-family); }
  .copy-btn.ok { color: var(--vscode-charts-green, #3fb950); border-color: var(--vscode-charts-green, #3fb950); }
  .bubble pre:hover .copy-btn, details.tool .res-wrap:hover .copy-btn { opacity: 1; }
  .bubble pre { position: relative; }

  .turn-actions { display: flex; gap: .3rem; margin-left: auto; opacity: 0; transition: opacity .15s; }
  .agent-turn:hover .turn-actions { opacity: 1; }
  .turn-actions button { padding: .1rem .45rem; font-size: .68rem; background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); border-radius: 3px; cursor: pointer; font-family: var(--vscode-font-family); }
  .turn-actions button:hover { background: var(--vscode-list-hoverBackground); }
  .turn-actions button.pinned { background: var(--vscode-charts-yellow, #d29922); color: #000; border-color: var(--vscode-charts-yellow, #d29922); }
  .agent-turn.pinned .bubble { border-left: 3px solid var(--vscode-charts-yellow, #d29922); }
  .agent-turn.muted { display: none; }
  .agent-turn.solo-hidden { display: none; }

  #agent-filters { display: flex; gap: .35rem; flex-wrap: wrap; align-items: center; font-size: .72rem; padding: .35rem .8rem; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); }
  #agent-filters .filter-label { opacity: .65; margin-right: .3rem; }
  #agent-filters .chip { display: inline-flex; align-items: center; gap: .25rem; padding: .15rem .5rem; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 12px; cursor: pointer; user-select: none; }
  #agent-filters .chip:hover { background: var(--vscode-list-hoverBackground); }
  #agent-filters .chip.muted { opacity: .45; text-decoration: line-through; }
  #agent-filters .chip.solo { background: var(--vscode-charts-blue, #58a6ff); color: #fff; border-color: var(--vscode-charts-blue, #58a6ff); }
  #agent-filters .chip .dot { width: 8px; height: 8px; border-radius: 50%; }
  #agent-filters .clear { margin-left: auto; padding: .15rem .5rem; background: transparent; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: .72rem; }
  #agent-filters .clear:hover { text-decoration: underline; }
  #agent-filters.empty { display: none; }

  .system-msg { font-size: .78rem; margin: .5rem 0; padding: .5rem .75rem; background: var(--vscode-editorWidget-background); border-left: 3px solid var(--vscode-charts-blue, #58a6ff); border-radius: 4px; line-height: 1.5; }
  .system-msg strong { color: var(--vscode-charts-blue, #58a6ff); }
  .task-end { font-size: .75rem; opacity: .8; margin-top: .75rem; padding: .45rem .7rem; background: var(--vscode-editorWidget-background); border-radius: 4px; }
  .task-end.failed { color: var(--vscode-charts-red, #f85149); }
  .task-end.complete { color: var(--vscode-charts-green, #3fb950); }
  .empty { opacity: .6; text-align: center; padding: 2rem; font-size: .85rem; }
  .inline-code { background: var(--vscode-textCodeBlock-background); padding: 0 .25rem; font-family: var(--vscode-editor-font-family), monospace; }

  #input-bar { display: flex; gap: .5rem; padding: .6rem .8rem; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); align-items: flex-end; }
  #input-bar textarea { flex: 1; resize: none; font-family: var(--vscode-font-family); font-size: .85rem; padding: .5rem .65rem; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: none; min-height: 2.2rem; max-height: 8rem; line-height: 1.45; }
  #input-bar textarea:focus { border-color: var(--vscode-focusBorder); }
  #input-bar textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
  #input-bar button { padding: .45rem .75rem; font-size: .8rem; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; white-space: nowrap; }
  #input-bar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #input-bar button.primary:hover { background: var(--vscode-button-hoverBackground); }
  #input-bar button:disabled { opacity: .5; cursor: default; }
  #input-bar select { font-family: var(--vscode-font-family); font-size: .78rem; padding: .35rem .45rem; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: none; cursor: pointer; }
  #input-bar select:focus { border-color: var(--vscode-focusBorder); }

  .approval-card { margin: .75rem 0; padding: .7rem .85rem; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-charts-yellow, #d29922); border-radius: 8px; font-size: .83rem; }
  .approval-card .approval-head { font-weight: 600; margin-bottom: .35rem; display: flex; align-items: center; gap: .4rem; }
  .approval-card .approval-head::before { content: '⏳'; }
  .approval-card .approval-detail { opacity: .8; margin-bottom: .5rem; line-height: 1.4; }
  .approval-card .approval-actions { display: flex; gap: .5rem; }
  .approval-card .approval-actions button { padding: .3rem .7rem; font-size: .78rem; font-weight: 600; border: none; border-radius: 4px; cursor: pointer; }
  .approval-card .btn-approve { background: var(--vscode-charts-green, #3fb950); color: #fff; }
  .approval-card .btn-reject { background: var(--vscode-charts-red, #f85149); color: #fff; }
  .approval-card .btn-approve:hover { opacity: .85; }
  .approval-card .btn-reject:hover { opacity: .85; }
  .approval-card.decided { opacity: .7; border-color: var(--vscode-panel-border); }
  .approval-card.decided .approval-actions { display: none; }
  .approval-card.decided .approval-head::before { content: '✓'; }
</style>
</head>
<body>
  <header>
    <h2>Agent Chat</h2>
    <span class="meta" id="meta">waiting for task…</span>
  </header>
  <div id="agent-filters" class="empty"></div>
  <div id="log"><div class="empty">Type a task below or run <span class="inline-code">Ujima: New Task</span> from the command palette.</div></div>
  <div id="input-bar">
    <textarea id="prompt" rows="1" placeholder="Describe a task for the team…"></textarea>
    <select id="mode-select" title="Orchestrator mode">
      <option value="auto">Auto</option>
      <option value="manual">Broadcast</option>
    </select>
    <button class="primary" id="send-btn">Send</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const meta = document.getElementById('meta');

  const tasks = new Map();
  let activeTaskId = null;

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function jsonOrString(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function colorForAgent(id) {
    const hue = hashStr(id) % 360;
    return 'hsl(' + hue + ', 55%, 45%)';
  }

  function initialsFor(name) {
    const words = String(name || '').split(/[\\s\\-_]+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function timeStr(d) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  function scrollBottom() {
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  function clearEmpty() {
    const e = log.querySelector('.empty');
    if (e) e.remove();
  }

  // Minimal, safe markdown renderer. Inputs are HTML-escaped first; we then
  // re-introduce a small set of tags. Supports fenced code blocks, headings,
  // lists, bold/italic, inline code, links ([t](url)), and bare-URL autolinks.
  function renderMarkdown(raw) {
    if (!raw) return '';
    const codeBlocks = [];
    let src = String(raw).replace(/\`\`\`([a-zA-Z0-9_-]*)\\n?([\\s\\S]*?)\`\`\`/g, (_m, _lang, body) => {
      const idx = codeBlocks.length;
      codeBlocks.push(body);
      return '\\u0000CB' + idx + '\\u0000';
    });
    src = escapeHtml(src);

    const blocks = src.split(/\\n{2,}/);
    const out = [];
    for (const block of blocks) {
      const placeholder = block.match(/^\\u0000CB(\\d+)\\u0000$/);
      if (placeholder) {
        out.push('<pre><code>' + escapeHtml(codeBlocks[parseInt(placeholder[1], 10)]) + '</code></pre>');
        continue;
      }
      const trimmed = block.trim();
      if (!trimmed) continue;

      const h = trimmed.match(/^(#{1,3})\\s+(.+)$/);
      if (h && !/\\n/.test(trimmed)) {
        out.push('<h' + h[1].length + '>' + renderInline(h[2]) + '</h' + h[1].length + '>');
        continue;
      }
      if (/^---+$/.test(trimmed)) { out.push('<hr>'); continue; }

      const lines = trimmed.split(/\\n/);
      const isUl = lines.every((l) => /^\\s*[-*]\\s+/.test(l));
      const isOl = lines.every((l) => /^\\s*\\d+\\.\\s+/.test(l));
      if (isUl || isOl) {
        const tag = isUl ? 'ul' : 'ol';
        const items = lines.map((l) => {
          const content = l.replace(/^\\s*(?:[-*]|\\d+\\.)\\s+/, '');
          return '<li>' + renderInline(content) + '</li>';
        }).join('');
        out.push('<' + tag + '>' + items + '</' + tag + '>');
        continue;
      }

      const para = lines.map(renderInline).join('<br>');
      out.push('<p>' + para + '</p>');
    }
    return out.join('');
  }

  function renderInline(text) {
    let t = text;
    t = t.replace(/\`([^\`]+)\`/g, (_m, code) => '<code>' + code + '</code>');
    t = t.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+|mailto:[^\\s)]+)\\)/g, (_m, label, url) => {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    t = t.replace(/(^|[^">=])((?:https?:\\/\\/)[^\\s<]+[^\\s<.,;:!?)\\]])/g, (_m, prefix, url) => {
      return prefix + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
    t = t.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[\\s(])\\*([^*\\n]+)\\*(?=[\\s).,;:!?]|$)/g, '$1<em>$2</em>');
    t = t.replace(/(^|[\\s(])_([^_\\n]+)_(?=[\\s).,;:!?]|$)/g, '$1<em>$2</em>');
    return t;
  }

  function ensureTask(taskId, prompt, agentIds) {
    if (tasks.has(taskId)) return tasks.get(taskId);
    clearEmpty();
    const wrapper = document.createElement('div');
    wrapper.className = 'task';
    wrapper.dataset.taskId = taskId;
    const promptEl = document.createElement('div');
    promptEl.className = 'task-prompt';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Task · ' + taskId;
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = prompt || '';
    promptEl.appendChild(label);
    promptEl.appendChild(body);
    wrapper.appendChild(promptEl);
    log.appendChild(wrapper);
    const info = { el: wrapper, promptEl, agents: new Map(), agentIds: agentIds || [], taskId };
    tasks.set(taskId, info);
    meta.textContent = 'task ' + taskId + ' · ' + (agentIds?.length ?? 0) + ' agents';
    activeTaskId = taskId;
    return info;
  }

  function ensureAgent(task, agentId) {
    let a = task.agents.get(agentId);
    if (!a) {
      a = { turns: [], toolsById: new Map() };
      task.agents.set(agentId, a);
    }
    return a;
  }

  function startTurn(task, agentId) {
    const a = ensureAgent(task, agentId);
    const turnEl = document.createElement('div');
    turnEl.className = 'agent-turn';
    turnEl.dataset.agentId = agentId;
    turnEl.dataset.taskId = task.taskId;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = colorForAgent(agentId);
    avatar.textContent = initialsFor(agentId);
    avatar.title = agentId;
    turnEl.appendChild(avatar);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'turn-body';
    const head = document.createElement('div');
    head.className = 'turn-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = agentId;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const timeEl = document.createElement('span');
    timeEl.className = 'time';
    timeEl.textContent = timeStr(new Date());
    head.appendChild(nameEl);
    head.appendChild(dot);
    head.appendChild(timeEl);

    const actions = document.createElement('div');
    actions.className = 'turn-actions';
    actions.appendChild(makeTurnAction('Retry', 'retry the task prompt', () => retryTask(task)));
    actions.appendChild(makeTurnAction('Cancel', 'kill this agent only', () => cancelAgent(agentId)));
    const pinBtn = makeTurnAction('Pin', 'keep pinned across resets', () => togglePin(turnEl, pinBtn));
    actions.appendChild(pinBtn);
    head.appendChild(actions);
    bodyEl.appendChild(head);

    const bubble = document.createElement('div');
    bubble.className = 'bubble live empty';
    bodyEl.appendChild(bubble);

    turnEl.appendChild(bodyEl);
    task.el.appendChild(turnEl);

    registerAgentChip(agentId);
    applyFilters(turnEl);

    const turn = { el: turnEl, bodyEl, bubble, text: '', tools: [] };
    a.turns.push(turn);
    a.currentTurn = turn;
    return turn;
  }

  function makeTurnAction(label, title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return b;
  }

  function retryTask(task) {
    const prompt = task.promptEl?.querySelector('.body')?.textContent || '';
    if (!prompt) return;
    vscode.postMessage({ type: 'task.retry', prompt, taskId: task.taskId, mode: modeSelect ? modeSelect.value : 'auto' });
  }

  function cancelAgent(agentId) {
    vscode.postMessage({ type: 'agent.cancel', agentId });
  }

  function togglePin(turnEl, btn) {
    const on = !turnEl.classList.contains('pinned');
    turnEl.classList.toggle('pinned', on);
    btn.classList.toggle('pinned', on);
    btn.textContent = on ? 'Pinned' : 'Pin';
  }

  function currentTurn(task, agentId) {
    const a = ensureAgent(task, agentId);
    if (!a.currentTurn) return startTurn(task, agentId);
    return a.currentTurn;
  }

  function renderBubble(turn) {
    if (!turn.text) {
      turn.bubble.classList.add('empty');
      turn.bubble.innerHTML = '';
      return;
    }
    turn.bubble.classList.remove('empty');
    turn.bubble.innerHTML = renderMarkdown(turn.text);
    decorateCodeBlocks(turn.bubble);
  }

  function decorateCodeBlocks(root) {
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector(':scope > .copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.textContent = 'Copy';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const code = pre.querySelector('code');
        const text = (code || pre).textContent || '';
        copyToClipboard(text, btn);
      });
      pre.appendChild(btn);
    });
  }

  function copyToClipboard(text, btn) {
    const done = () => {
      const orig = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('ok');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('ok'); }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } finally { document.body.removeChild(ta); }
  }

  function appendDelta(task, agentId, text) {
    if (!text) return;
    const turn = currentTurn(task, agentId);
    turn.text += text;
    renderBubble(turn);
    scrollBottom();
  }

  function addToolCall(task, agentId, payload) {
    const turn = currentTurn(task, agentId);
    turn.bubble.classList.remove('live');
    const det = document.createElement('details');
    det.className = 'tool';
    det.open = false;
    const argsStr = jsonOrString(payload.arguments ?? {});
    det.innerHTML =
      '<summary><span class="chev"></span><span>→</span><span class="tname">' + escapeHtml(payload.name || '?') + '</span>' +
      '<span class="tmeta" data-status>running…</span></summary>' +
      '<pre data-args>' + escapeHtml(argsStr) + '</pre>';
    turn.bodyEl.appendChild(det);
    const a = ensureAgent(task, agentId);
    a.toolsById.set(payload.id, { el: det, turn });
    scrollBottom();
  }

  function addToolResult(task, agentId, payload) {
    const a = ensureAgent(task, agentId);
    const rec = a.toolsById.get(payload.id);
    if (!rec) return;
    const det = rec.el;
    const isErr = !!payload.isError;
    if (isErr) det.classList.add('err');
    const metaEl = det.querySelector('[data-status]');
    if (metaEl) {
      const ms = typeof payload.durationMs === 'number' ? ' · ' + payload.durationMs + 'ms' : '';
      metaEl.textContent = (isErr ? 'error' : 'done') + ms;
    }

    const resText = jsonOrString(payload.content);
    const wrap = document.createElement('div');
    wrap.className = 'res-wrap';
    const resPre = document.createElement('pre');
    resPre.textContent = resText;
    resPre.style.borderTop = '1px solid var(--vscode-panel-border)';
    wrap.appendChild(resPre);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', (e) => { e.preventDefault(); copyToClipboard(resText, copyBtn); });
    wrap.appendChild(copyBtn);

    const lineCount = resText.split('\\n').length;
    if (lineCount > 14) {
      resPre.classList.add('res-clipped');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'res-toggle';
      toggle.textContent = 'Show full (' + lineCount + ' lines)';
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const clipped = resPre.classList.toggle('res-clipped');
        toggle.textContent = clipped ? 'Show full (' + lineCount + ' lines)' : 'Collapse';
      });
      wrap.appendChild(toggle);
    }

    det.appendChild(wrap);
    scrollBottom();
  }

  function finishAgent(task, agentId, payload) {
    const a = ensureAgent(task, agentId);
    const turn = a.currentTurn;
    const reason = payload.exitReason || 'completed';
    if (turn) {
      turn.bubble.classList.remove('live');
      turn.el.classList.add('done');
      if (reason === 'error') { turn.el.classList.add('err'); turn.bubble.classList.add('err'); }
      if (reason === 'escalated') turn.el.classList.add('esc');

      const finalText = payload.finalText || '';
      if (finalText && finalText !== turn.text) {
        if (turn.text) {
          const finalBubble = document.createElement('div');
          finalBubble.className = 'bubble final';
          finalBubble.innerHTML = renderMarkdown(finalText);
          decorateCodeBlocks(finalBubble);
          turn.bodyEl.appendChild(finalBubble);
        } else {
          turn.text = finalText;
          renderBubble(turn);
          turn.bubble.classList.add('final');
        }
      } else if (finalText && finalText === turn.text) {
        turn.bubble.classList.add('final');
      }
    }
    a.currentTurn = undefined;
    scrollBottom();
  }

  function handleEvent(event) {
    const taskId = event.task_id || activeTaskId;
    if (!taskId) return;
    const task = tasks.get(taskId) || ensureTask(taskId, '', []);
    const agentId = event.publisher;
    const p = event.payload || {};
    switch (event.type) {
      case 'agent_turn_started':
        startTurn(task, agentId);
        break;
      case 'agent_thought_delta':
        appendDelta(task, agentId, p.text || '');
        break;
      case 'agent_tool_call':
        addToolCall(task, agentId, p);
        break;
      case 'agent_tool_result':
        addToolResult(task, agentId, p);
        break;
      case 'agent_finished':
        finishAgent(task, agentId, p);
        break;
      case 'agent_error':
        appendDelta(task, agentId, '\\n\\n**[error]** ' + (p.error || 'unknown') + '\\n');
        break;
      case 'planning_completed': {
        const planEl = document.createElement('div');
        planEl.className = 'system-msg';
        const assigns = p.assignments || [];
        const lines = assigns.map(function(a) {
          const deps = a.dependsOn && a.dependsOn.length > 0 ? ' (waits for: ' + a.dependsOn.join(', ') + ')' : ' (runs immediately)';
          return '• ' + a.agentId + deps + ': ' + a.subprompt;
        });
        planEl.innerHTML = '<strong>Planner decided:</strong><br>' + lines.join('<br>');
        if (task) task.el.appendChild(planEl);
        scrollBottom();
        break;
      }
      case 'wave_started': {
        const waveEl = document.createElement('div');
        waveEl.className = 'system-msg';
        waveEl.innerHTML = '<strong>Wave ' + (p.wave + 1) + '/' + p.totalWaves + '</strong> — starting agents: ' + (p.agents || []).join(', ');
        if (task) task.el.appendChild(waveEl);
        scrollBottom();
        break;
      }
      case 'approval_requested':
        renderApproval({
          approvalId: p.approval_id || event.event_id,
          taskId: taskId,
          artifactKey: p.condition || '',
          domain: p.kind || 'approval',
          proposedBy: p.agent_id || agentId,
          summary: p.partial_output || '',
        });
        break;
    }
  }

  function handleTaskEnded(msg) {
    const task = tasks.get(msg.taskId);
    if (!task) return;
    const end = document.createElement('div');
    end.className = 'task-end ' + (msg.status === 'completed' || msg.status === 'complete' ? 'complete' : msg.status === 'failed' ? 'failed' : '');
    end.textContent = 'Task ' + msg.taskId + ' → ' + msg.status + (msg.error ? ' · ' + msg.error : '');
    task.el.appendChild(end);
    meta.textContent = 'last: ' + msg.taskId + ' · ' + msg.status;
    scrollBottom();
  }

  // --- Per-agent mute / solo filters ---
  const filterBar = document.getElementById('agent-filters');
  const agentChips = new Map();
  const muted = new Set();
  let soloAgent = null;

  function registerAgentChip(agentId) {
    if (agentChips.has(agentId)) return;
    if (filterBar.classList.contains('empty')) {
      filterBar.classList.remove('empty');
      const lbl = document.createElement('span');
      lbl.className = 'filter-label';
      lbl.textContent = 'Filter:';
      filterBar.appendChild(lbl);
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'clear';
      clear.textContent = 'Reset';
      clear.addEventListener('click', (e) => { e.preventDefault(); resetFilters(); });
      filterBar.dataset.clearBtn = '1';
      filterBar.appendChild(clear);
    }
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.dataset.agentId = agentId;
    chip.title = 'click to mute · shift-click to solo';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = colorForAgent(agentId);
    chip.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = agentId;
    chip.appendChild(label);
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.shiftKey) {
        soloAgent = soloAgent === agentId ? null : agentId;
      } else {
        if (muted.has(agentId)) muted.delete(agentId); else muted.add(agentId);
      }
      refreshFilters();
    });
    // Insert before the Reset button (which is last)
    const clearBtn = filterBar.querySelector('.clear');
    filterBar.insertBefore(chip, clearBtn);
    agentChips.set(agentId, chip);
  }

  function resetFilters() {
    muted.clear();
    soloAgent = null;
    refreshFilters();
  }

  function refreshFilters() {
    agentChips.forEach((chip, id) => {
      chip.classList.toggle('muted', muted.has(id));
      chip.classList.toggle('solo', soloAgent === id);
    });
    document.querySelectorAll('.agent-turn').forEach(applyFilters);
  }

  function applyFilters(turnEl) {
    const id = turnEl.dataset.agentId;
    if (!id) return;
    const isMuted = muted.has(id);
    const isSoloHidden = soloAgent !== null && soloAgent !== id;
    turnEl.classList.toggle('muted', isMuted);
    turnEl.classList.toggle('solo-hidden', isSoloHidden);
  }

  // --- Input bar ---
  const promptEl = document.getElementById('prompt');
  const modeSelect = document.getElementById('mode-select');
  const sendBtn = document.getElementById('send-btn');
  let sending = false;

  function submitTask() {
    const text = promptEl.value.trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Starting…';
    vscode.postMessage({ type: 'task.submit', prompt: text, mode: modeSelect.value });
    promptEl.value = '';
    promptEl.style.height = 'auto';
  }

  sendBtn.addEventListener('click', submitTask);
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitTask(); }
  });
  promptEl.addEventListener('input', () => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 128) + 'px';
  });

  function unlockInput() {
    sending = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
  }

  // --- Approval cards ---
  const approvalCards = new Map();

  function renderApproval(msg) {
    const taskId = msg.taskId || activeTaskId;
    if (!taskId) return;
    const task = tasks.get(taskId) || ensureTask(taskId, '', []);
    const card = document.createElement('div');
    card.className = 'approval-card';
    card.dataset.approvalId = msg.approvalId;
    const head = document.createElement('div');
    head.className = 'approval-head';
    head.textContent = 'Approval required';
    const detail = document.createElement('div');
    detail.className = 'approval-detail';
    detail.innerHTML = '<strong>' + escapeHtml(msg.domain) + '</strong> · ' + escapeHtml(msg.artifactKey) + (msg.summary ? '<br>' + escapeHtml(msg.summary) : '') + '<br><span style="opacity:.65">proposed by ' + escapeHtml(msg.proposedBy) + '</span>';
    const actions = document.createElement('div');
    actions.className = 'approval-actions';
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn-approve';
    approveBtn.textContent = 'Approve';
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-reject';
    rejectBtn.textContent = 'Reject';
    approveBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'approval.decide', approvalId: msg.approvalId, decision: 'approved' });
      card.classList.add('decided');
      head.textContent = 'Approved';
    });
    rejectBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'approval.decide', approvalId: msg.approvalId, decision: 'rejected' });
      card.classList.add('decided');
      head.textContent = 'Rejected';
    });
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    card.appendChild(head);
    card.appendChild(detail);
    card.appendChild(actions);
    task.el.appendChild(card);
    approvalCards.set(msg.approvalId, card);
    scrollBottom();
  }

  function markApprovalDecided(msg) {
    const card = approvalCards.get(msg.approvalId);
    if (!card) return;
    card.classList.add('decided');
    const head = card.querySelector('.approval-head');
    if (head) head.textContent = msg.decision === 'approved' ? 'Approved' : 'Rejected';
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'task.started') {
      ensureTask(msg.taskId, msg.prompt, msg.agentIds || []);
      unlockInput();
    } else if (msg.type === 'task.ended') {
      handleTaskEnded(msg);
      unlockInput();
    } else if (msg.type === 'stream') {
      handleEvent(msg.event);
    } else if (msg.type === 'approval.requested') {
      renderApproval(msg);
    } else if (msg.type === 'approval.decided') {
      markApprovalDecided(msg);
    } else if (msg.type === 'reset') {
      tasks.clear();
      approvalCards.clear();
      log.innerHTML = '<div class="empty">Type a task below to get started.</div>';
      meta.textContent = 'waiting for task…';
      agentChips.clear();
      muted.clear();
      soloAgent = null;
      filterBar.innerHTML = '';
      filterBar.classList.add('empty');
      unlockInput();
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}