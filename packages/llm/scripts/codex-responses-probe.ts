import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { jsonSchema, stepCountIs, streamText, tool } from 'ai';
import { selectLanguageModel } from '../src/select';

const authPath = join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'auth.json');
const auth = JSON.parse(readFileSync(authPath, 'utf8')) as {
  tokens?: { access_token?: string };
};
const accessToken = auth.tokens?.access_token;
if (!accessToken) throw new Error(`No Codex access token in ${authPath}`);

const model = selectLanguageModel({
  kind: 'openai-codex',
  modelId: process.env.UJIMA_CODEX_REAL_MODEL || 'gpt-5.4-mini',
  apiKey: accessToken,
  reasoningEffort: 'none',
});

const result = streamText({
  model,
  messages: [{
    role: 'user',
    content: 'Use get_magic_word. Then reply with exactly the tool result and nothing else.',
  }],
  stopWhen: stepCountIs(2),
  tools: {
    get_magic_word: tool({
      description: 'Returns required probe text.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => 'ujima-codex-real-ok',
    }),
  },
});

const text = (await result.text).trim();
const steps = await result.steps;
const toolCalls = steps.flatMap((step) => step.content.filter((part) => part.type === 'tool-call'));
if (text !== 'ujima-codex-real-ok' || toolCalls.length === 0) {
  console.error(JSON.stringify({
    text,
    toolCalls: toolCalls.length,
    steps: steps.length,
    content: steps.map((step) => step.content),
  }, null, 2));
  process.exit(1);
}
console.log(text);
