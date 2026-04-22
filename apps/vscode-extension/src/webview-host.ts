import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';

export interface RenderWebviewHtmlOptions {
  webview: vscode.Webview;
  webviewDist: vscode.Uri;
  /** Globals to inject as window.<key> before the main bundle loads. Values are JSON.stringified. */
  globals?: Record<string, unknown>;
}

export function resolveWebviewDist(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'webview', 'dist');
}

export function renderWebviewHtml(options: RenderWebviewHtmlOptions): string {
  const { webview, webviewDist, globals } = options;
  const htmlPath = vscode.Uri.joinPath(webviewDist, 'index.html').fsPath;
  const raw = fs.readFileSync(htmlPath, 'utf8');
  const nonce = crypto.randomBytes(16).toString('base64');
  const cspSource = webview.cspSource;
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} https: data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `connect-src ${cspSource}`,
  ].join('; ');

  const globalsSnippet = globals
    ? `<script nonce="${nonce}">${Object.entries(globals)
        .map(([k, v]) => `window.${k}=${safeJson(v)};`)
        .join('')}</script>`
    : '';

  return raw
    .replace(
      /<head>/,
      `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">${globalsSnippet}`,
    )
    .replace(/<script(\s[^>]*)?>/g, (_match, attrs: string | undefined) => {
      return `<script nonce="${nonce}"${attrs ?? ''}>`;
    })
    .replace(/(src|href)="(\/?(?:assets|main)[^"]+)"/g, (_m, attr: string, asset: string) => {
      const clean = asset.startsWith('/') ? asset.slice(1) : asset;
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDist, clean));
      return `${attr}="${uri.toString()}"`;
    });
}

export function webviewFallbackHtml(reason: string): string {
  const safe = reason.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c);
  return `<!doctype html><html><body style="font-family: system-ui; padding: 1rem;">
  <h3>Ujima webview</h3>
  <p>The webview bundle isn't built yet. Run <code>bun --filter @ujima/webview build</code> and reopen.</p>
  <pre style="opacity: 0.7; font-size: 0.8em;">${safe}</pre>
  </body></html>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
