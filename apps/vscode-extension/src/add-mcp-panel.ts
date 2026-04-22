import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { MCPDef } from '@ujima/shared';
import { connectMCP, parseMCPConfigJSON } from '@ujima/mcp-client';

interface TestMessage {
  type: 'test' | 'save';
  json: string;
}
interface CallMessage {
  type: 'call';
  json: string;
  tool: string;
  args: string;
}

interface ResultMessage {
  type: 'result';
  ok: boolean;
  message: string;
  tools?: string[];
}
interface CallResultMessage {
  type: 'callResult';
  ok: boolean;
  message: string;
  content?: string;
}

export function openAddMcpPanel(channel: vscode.OutputChannel): void {
  const panel = vscode.window.createWebviewPanel(
    'ujima.addMcp',
    'Ujima — Add MCP Server',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = renderHtml();

  panel.webview.onDidReceiveMessage(async (msg: TestMessage | CallMessage) => {
    if (msg.type === 'test') {
      const result = await runTest(msg.json, channel);
      post(panel, result);
      return;
    }
    if (msg.type === 'call') {
      const result = await runToolCall(msg.json, msg.tool, msg.args, channel);
      post(panel, result);
      return;
    }
    if (msg.type === 'save') {
      const result = await runTest(msg.json, channel);
      if (!result.ok) {
        post(panel, result);
        return;
      }
      const defs = parseMCPConfigJSON(msg.json).defs;
      const cfg = vscode.workspace.getConfiguration('ujima.mcp');
      const existing = (cfg.get<unknown[]>('custom') ?? []).filter(
        (e): e is Record<string, unknown> => typeof e === 'object' && e !== null,
      );
      const byId = new Map<string, Record<string, unknown>>();
      for (const e of existing) {
        const id = typeof e.id === 'string' ? e.id : undefined;
        if (id) byId.set(id, e);
      }
      for (const def of defs) byId.set(def.id, def as unknown as Record<string, unknown>);
      await cfg.update('custom', [...byId.values()], vscode.ConfigurationTarget.Global);
      post(panel, {
        type: 'result',
        ok: true,
        message: `Saved ${defs.length} server${defs.length === 1 ? '' : 's'} to ujima.mcp.custom (User settings). Agents can now reference ${defs.map((d) => `"${d.id}"`).join(', ')}.`,
        tools: result.tools,
      });
    }
  });
}

function post(panel: vscode.WebviewPanel, msg: ResultMessage | CallResultMessage): void {
  void panel.webview.postMessage(msg);
}

async function runToolCall(
  json: string,
  toolName: string,
  argsJson: string,
  channel: vscode.OutputChannel,
): Promise<CallResultMessage> {
  if (!toolName.trim()) {
    return { type: 'callResult', ok: false, message: 'Pick a tool first.' };
  }
  let defs: MCPDef[];
  try {
    defs = parseMCPConfigJSON(json).defs;
  } catch (err) {
    return { type: 'callResult', ok: false, message: `JSON parse failed: ${errMsg(err)}` };
  }
  if (defs.length === 0) {
    return { type: 'callResult', ok: false, message: 'No server entries in JSON.' };
  }
  let args: unknown = {};
  const trimmed = argsJson.trim();
  if (trimmed) {
    try {
      args = JSON.parse(trimmed);
    } catch (err) {
      return { type: 'callResult', ok: false, message: `Args JSON parse failed: ${errMsg(err)}` };
    }
  }
  const [def] = defs;
  if (!def) return { type: 'callResult', ok: false, message: 'No server entries in JSON.' };
  channel.appendLine(`[add-mcp] calling ${def.id}.${toolName}`);
  try {
    const conn = await connectMCP(def);
    try {
      const result = await conn.callTool({ agentId: 'add-mcp-smoke' }, toolName, args);
      const contentStr = truncate(safeStringify(result.content), 4000);
      const ok = !result.isError;
      channel.appendLine(`[add-mcp] ${def.id}.${toolName} ${ok ? 'ok' : 'returned isError=true'}`);
      return {
        type: 'callResult',
        ok,
        message: ok
          ? `Tool "${toolName}" returned successfully.`
          : `Tool "${toolName}" returned isError=true.`,
        content: contentStr,
      };
    } finally {
      await conn.close();
    }
  } catch (err) {
    channel.appendLine(`[add-mcp] ${def.id}.${toolName} failed: ${errMsg(err)}`);
    return { type: 'callResult', ok: false, message: `Tool call failed: ${errMsg(err)}` };
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n… [truncated, ${s.length - max} more chars]` : s;
}

async function runTest(json: string, channel: vscode.OutputChannel): Promise<ResultMessage> {
  let defs: MCPDef[];
  try {
    const parsed = parseMCPConfigJSON(json);
    defs = parsed.defs;
    if (defs.length === 0) {
      return { type: 'result', ok: false, message: 'JSON parsed but no server entries found. Expected `{ "mcpServers": { "<id>": {...} } }` or a single MCPDef.' };
    }
  } catch (err) {
    return { type: 'result', ok: false, message: `JSON parse failed: ${errMsg(err)}` };
  }

  const [def] = defs;
  if (!def) return { type: 'result', ok: false, message: 'No server entries in JSON.' };
  channel.appendLine(`[add-mcp] testing ${def.id} (${def.transport})`);
  try {
    const conn = await connectMCP(def);
    const tools = await conn.listTools();
    await conn.close();
    channel.appendLine(`[add-mcp] ${def.id} ok — ${tools.length} tools`);
    return {
      type: 'result',
      ok: true,
      message: `Connected to "${def.id}" (${def.transport}). Discovered ${tools.length} tool${tools.length === 1 ? '' : 's'}.`,
      tools: tools.map((t) => t.name),
    };
  } catch (err) {
    channel.appendLine(`[add-mcp] ${def.id} failed: ${errMsg(err)}`);
    return {
      type: 'result',
      ok: false,
      message: `Connection failed: ${errMsg(err)}`,
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const EXAMPLE_JSON = `{
  "mcpServers": {
    "my-figma": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--stdio"],
      "env": { "FIGMA_API_KEY": "figd_..." }
    }
  }
}`;

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
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 1.25rem; }
  h2 { margin: 0 0 .25rem 0; font-size: 1.05rem; }
  p.hint { margin: 0 0 1rem 0; opacity: .75; font-size: .85rem; }
  textarea { width: 100%; min-height: 18rem; font-family: var(--vscode-editor-font-family), monospace; font-size: var(--vscode-editor-font-size, 13px); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: .5rem; box-sizing: border-box; }
  .row { margin-top: .75rem; display: flex; gap: .5rem; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: .4rem .9rem; cursor: pointer; font-size: .85rem; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  #result { margin-top: 1rem; padding: .75rem; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-editorWidget-background); white-space: pre-wrap; font-size: .85rem; display: none; }
  #result.ok { border-left-color: var(--vscode-charts-green, #3fb950); }
  #result.err { border-left-color: var(--vscode-charts-red, #f85149); }
  #tools { margin-top: .5rem; opacity: .85; font-size: .8rem; }
  code { background: var(--vscode-textCodeBlock-background); padding: 0 .25rem; }
</style>
</head>
<body>
  <h2>Add MCP Server</h2>
  <p class="hint">Paste an <code>mcpServers</code> JSON block or a single MCPDef. Test first — connection must succeed before save.</p>
  <textarea id="json" spellcheck="false">${EXAMPLE_JSON}</textarea>
  <div class="row">
    <button id="test">Test connection</button>
    <button id="save" class="secondary">Save</button>
  </div>
  <div id="result"></div>
  <div id="tools"></div>

  <div id="smoke" style="display:none; margin-top:1.25rem; padding-top:1rem; border-top:1px solid var(--vscode-panel-border, rgba(128,128,128,.2));">
    <h2>Smoke test a tool <span style="opacity:.6; font-weight:normal; font-size:.85rem;">(optional)</span></h2>
    <p class="hint">Confirm the MCP isn't just handshaking — actually call a tool.</p>
    <div class="row" style="margin-top:0;">
      <select id="toolPick" style="flex:0 0 14rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border:1px solid var(--vscode-input-border, transparent); padding:.3rem;"></select>
      <button id="call">Call tool</button>
    </div>
    <textarea id="args" spellcheck="false" placeholder='Args JSON (leave blank for no args). e.g. { "path": "/tmp" }' style="min-height:6rem; margin-top:.5rem;"></textarea>
    <div id="callMsg" style="display:none; margin-top:.75rem; padding:.5rem .75rem; border-left:3px solid var(--vscode-focusBorder); background: var(--vscode-editorWidget-background); font-size:.85rem;"></div>
    <pre id="callContent" style="display:none; margin-top:.5rem; padding:.5rem; background: var(--vscode-textCodeBlock-background); font-size:.8rem; max-height:18rem; overflow:auto; white-space:pre-wrap;"></pre>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const ta = document.getElementById('json');
  const btnTest = document.getElementById('test');
  const btnSave = document.getElementById('save');
  const btnCall = document.getElementById('call');
  const result = document.getElementById('result');
  const tools = document.getElementById('tools');
  const smoke = document.getElementById('smoke');
  const toolPick = document.getElementById('toolPick');
  const args = document.getElementById('args');
  const callMsg = document.getElementById('callMsg');
  const callContent = document.getElementById('callContent');

  function send(type) {
    btnTest.disabled = true;
    btnSave.disabled = true;
    btnCall.disabled = true;
    result.style.display = 'block';
    result.className = '';
    result.textContent = type === 'save' ? 'Saving…' : 'Testing connection…';
    tools.textContent = '';
    vscode.postMessage({ type, json: ta.value });
  }

  btnTest.addEventListener('click', () => send('test'));
  btnSave.addEventListener('click', () => send('save'));
  btnCall.addEventListener('click', () => {
    btnCall.disabled = true;
    callMsg.style.display = 'block';
    callMsg.className = '';
    callMsg.textContent = 'Calling tool…';
    callContent.style.display = 'none';
    callContent.textContent = '';
    vscode.postMessage({ type: 'call', json: ta.value, tool: toolPick.value, args: args.value });
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg && msg.type === 'result') {
      result.style.display = 'block';
      result.className = msg.ok ? 'ok' : 'err';
      result.textContent = msg.message;
      tools.textContent = msg.tools && msg.tools.length ? 'Tools: ' + msg.tools.join(', ') : '';
      btnTest.disabled = false;
      btnSave.disabled = false;
      if (msg.ok && msg.tools && msg.tools.length) {
        smoke.style.display = 'block';
        toolPick.innerHTML = '';
        for (const t of msg.tools) {
          const o = document.createElement('option');
          o.value = t; o.textContent = t;
          toolPick.appendChild(o);
        }
        btnCall.disabled = false;
      } else {
        smoke.style.display = 'none';
      }
    }
    if (msg && msg.type === 'callResult') {
      callMsg.style.display = 'block';
      callMsg.className = msg.ok ? 'ok' : 'err';
      callMsg.style.borderLeftColor = msg.ok ? 'var(--vscode-charts-green, #3fb950)' : 'var(--vscode-charts-red, #f85149)';
      callMsg.textContent = msg.message;
      if (msg.content) {
        callContent.style.display = 'block';
        callContent.textContent = msg.content;
      } else {
        callContent.style.display = 'none';
      }
      btnCall.disabled = false;
    }
  });
</script>
</body>
</html>`;
}