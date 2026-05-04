import { streamText } from 'ai';
import { describe, expect, test } from 'vitest';
import { selectLanguageModel } from './select';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-reasoner'] as const;

function readDeepSeekApiKey(): string {
  const home = process.env.UJIMA_HOME || join(homedir(), '.ujima');
  const dbPath = join(home, 'data', 'ujima.db');
  const keyRef = execSync(
    `sqlite3 "${dbPath}" "SELECT key_ref FROM provider_credentials WHERE provider_name = 'deepseek';"`,
    { encoding: 'utf-8' },
  ).trim();
  const key = readFileSync(join(home, 'secrets', keyRef), 'utf-8').trim();
  if (!key) throw new Error('DeepSeek API key is empty');
  return key;
}

describe.each(DEEPSEEK_MODELS)('DeepSeek reasoning with @ai-sdk/deepseek (%s)', (modelId) => {
  const apiKey = readDeepSeekApiKey();

  test('reasoning content streams without error and multi-turn works', async () => {
    const model = selectLanguageModel({ kind: 'deepseek', modelId, apiKey });

    const opts: Record<string, unknown> = {
      model,
      system: 'You are a helpful assistant.',
      messages: [{ role: 'user', content: 'Write the number 42 in words, then double it and write the result.' }],
    };

    if (modelId !== 'deepseek-reasoner') opts.temperature = 0.7;

    const result = streamText(opts as Parameters<typeof streamText>[0]);

    let sawReasoning = false;
    let sawError = false;
    let turns = 0;
    let finalText = '';

    for await (const part of result.fullStream) {
      if (part.type === 'error') { sawError = true; }
      if (part.type === 'reasoning' || part.type === 'reasoning-delta') sawReasoning = true;
      if (part.type === 'step-finish') turns++;
      if (part.type === 'text-delta') finalText += part.text;
    }

    expect(sawError).toBe(false);
    expect(sawReasoning).toBe(true);
    expect(turns).toBeGreaterThanOrEqual(1);
    expect(finalText.length).toBeGreaterThan(0);
    console.log(`[${modelId}] OK turns=${turns} reasoning=${sawReasoning} text=${finalText.slice(0, 80)}`);
  }, 60_000);
});
