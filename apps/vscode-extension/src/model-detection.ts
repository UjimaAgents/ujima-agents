import * as vscode from 'vscode';

export interface DetectedModel {
  id: string;
  label: string;
  description: string;
  source: 'vscode-lm' | 'anthropic' | 'openai' | 'ollama' | 'fallback';
  available: boolean;
}

export async function detectAvailableModels(): Promise<DetectedModel[]> {
  const results: DetectedModel[] = [];

  try {
    const lmModels = await vscode.lm.selectChatModels();
    for (const m of lmModels) {
      results.push({
        id: 'vscode-lm',
        label: `${m.name}`,
        description: `vscode.lm · ${m.vendor} · ${m.family}${m.maxInputTokens ? ` · ${Math.round(m.maxInputTokens / 1000)}k` : ''}`,
        source: 'vscode-lm',
        available: true,
      });
    }
  } catch {
    // vscode.lm API unavailable or no consent given
  }

  if (process.env.ANTHROPIC_API_KEY) {
    results.push(
      { id: 'claude-opus-4-8', label: 'claude-opus-4-8', description: 'Anthropic · best judgment (ANTHROPIC_API_KEY set)', source: 'anthropic', available: true },
      { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', description: 'Anthropic · balanced (ANTHROPIC_API_KEY set)', source: 'anthropic', available: true },
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5', description: 'Anthropic · fast (ANTHROPIC_API_KEY set)', source: 'anthropic', available: true },
    );
  }

  if (process.env.OPENAI_API_KEY) {
    results.push(
      { id: 'gpt-5.5', label: 'gpt-5.5', description: 'OpenAI · flagship (OPENAI_API_KEY set)', source: 'openai', available: true },
      { id: 'gpt-5.4', label: 'gpt-5.4', description: 'OpenAI · balanced (OPENAI_API_KEY set)', source: 'openai', available: true },
      { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', description: 'OpenAI · fast (OPENAI_API_KEY set)', source: 'openai', available: true },
      { id: 'gpt-5.4-nano', label: 'gpt-5.4-nano', description: 'OpenAI · tiny (OPENAI_API_KEY set)', source: 'openai', available: true },
      { id: 'gpt-4o', label: 'gpt-4o', description: 'OpenAI · stable (OPENAI_API_KEY set)', source: 'openai', available: true },
    );
  }

  const ollamaModels = await probeOllama();
  for (const m of ollamaModels) {
    results.push({
      id: `ollama/${m}`,
      label: m,
      description: 'Local via Ollama',
      source: 'ollama',
      available: true,
    });
  }

  if (results.length === 0) {
    results.push(
      { id: 'vscode-lm', label: 'vscode-lm', description: 'VS Code LM API — requires Copilot or compatible provider', source: 'fallback', available: false },
      { id: 'claude-opus-4-8', label: 'claude-opus-4-8', description: 'Anthropic — set ANTHROPIC_API_KEY', source: 'fallback', available: false },
      { id: 'gpt-5.5', label: 'gpt-5.5', description: 'OpenAI — set OPENAI_API_KEY', source: 'fallback', available: false },
      { id: 'gpt-4o', label: 'gpt-4o', description: 'OpenAI — set OPENAI_API_KEY', source: 'fallback', available: false },
      { id: 'ollama/llama3', label: 'ollama/llama3', description: 'Local — run Ollama on :11434', source: 'fallback', available: false },
    );
  }

  return results;
}

async function probeOllama(): Promise<string[]> {
  const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600);
    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
  } catch {
    return [];
  }
}
