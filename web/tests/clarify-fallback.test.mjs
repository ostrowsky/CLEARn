import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const platformRoot = path.join(root, 'platform');
const require = createRequire(path.join(platformRoot, 'package.json'));
const tsxRequire = createRequire(require.resolve('tsx/package.json'));
const { build } = tsxRequire('esbuild');
const temp = await fs.mkdtemp(path.join(platformRoot, '.tmp-clarify-fallback-'));
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalDebug = console.debug;
let assertions = 0;

try {
  const outfile = path.join(temp, 'client.mjs');
  await build({
    stdin: {
      contents: `export { apiClient } from './apps/client/src/lib/api.ts'; export { checkClarifyAnswer } from './packages/domain/src/clarifyValidation.ts'; export { staticContent } from './apps/client/src/lib/staticContent.ts';`,
      resolveDir: platformRoot,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: path.join(platformRoot, 'tsconfig.base.json'),
    plugins: [{
      name: 'test-api-config',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/config$/ }, args => args.importer.endsWith('/lib/api.ts') || args.importer.endsWith('\\lib\\api.ts') ? { path: 'api-config', namespace: 'test' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: "export const apiBaseUrl = 'https://api.clearn.test';", loader: 'js' }));
      },
    }],
  });
  const { apiClient, checkClarifyAnswer, staticContent } = await import(pathToFileURL(outfile).href);
  console.debug = () => {};
  const base = {
    userQuestion: 'Sorry, the bug is only reproducible on what?',
    expectedQuestion: 'Sorry, the bug is only reproducible on what?',
  };
  const feedback = staticContent.meta.practice.clarifyFeedback;
  const cases = [
    [base, true],
    [{ ...base, userQuestion: 'sorry the bug is only reproducible on what' }, true],
    [{ userQuestion: "Sorry, you've assigned the ticket to who?", expectedQuestion: 'Sorry, you have assigned the ticket to who?' }, true],
    [{ ...base, userQuestion: 'Sorry, the bug is reproducible where?' }, false],
    [{ ...base, userQuestion: 'Could you repeat the last part?', acceptedAnswers: ['Could you repeat the last part?'] }, true],
    [{ ...base, userQuestion: '' }, false],
    [{ ...base, userQuestion: 'aaaaaa', expectedQuestion: 'aaaaaa' }, false],
    [{ ...base, userQuestion: 'zxqwr', expectedQuestion: 'zxqwr' }, false],
  ];
  const mock = handler => {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/api/debug/log')) return new Response(null, { status: 204 });
      return handler(String(url), init);
    };
  };

  for (const status of [502, 503, 504]) {
    mock(() => new Response('This service has been suspended.', { status, headers: { 'Content-Type': 'text/html' } }));
    for (const [payload, accepted] of cases) {
      const result = await apiClient.checkClarify(payload);
      assert.equal(result.accepted, accepted, `HTTP ${status}: ${payload.userQuestion}`);
      assert.deepEqual(result, checkClarifyAnswer(payload, feedback));
      assert.ok(result.feedback.length > 0);
      assertions++;
    }
  }

  mock(() => { throw new TypeError('Failed to fetch'); });
  assert.equal((await apiClient.checkClarify(base)).accepted, true);
  assert.equal((await apiClient.checkClarify({ ...base, userQuestion: 'wrong answer' })).accepted, false);
  assertions += 2;

  globalThis.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, ms === 5000 ? 1 : ms, ...args);
  mock((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
  assert.equal((await apiClient.checkClarify(base)).accepted, true);
  globalThis.setTimeout = originalSetTimeout;
  assertions++;

  const online = { accepted: false, feedback: 'Server feedback takes precedence.' };
  mock(() => Response.json(online));
  assert.deepEqual(await apiClient.checkClarify(base), online);
  assertions++;

  const custom = structuredClone(staticContent);
  custom.meta.practice.clarifyFeedback.accepted = 'Custom admin success message';
  custom.meta.practice.clarifyFeedback.mismatch = 'Custom admin retry message';
  mock(() => Response.json(custom));
  await apiClient.getContent();
  mock(() => new Response('Service Suspended', { status: 503 }));
  assert.equal((await apiClient.checkClarify(base)).feedback, 'Custom admin success message');
  assert.equal((await apiClient.checkClarify({ ...base, userQuestion: 'wrong answer' })).feedback, 'Custom admin retry message');
  assert.deepEqual(await apiClient.getContent(), custom);
  assertions += 3;

  assert.equal((await apiClient.checkAskAfter({ question: 'You mentioned timing. Could you explain that?', detail: 'timing' })).accepted, true);
  assert.equal((await apiClient.checkQuestionFormation({
    userQuestion: 'What will they review?', sentence: 'Stakeholders will review return on investment.', answer: 'return on investment', whWord: 'What', expectedQuestion: 'What will stakeholders review?', acceptedQuestions: ['What will they review?'],
  })).accepted, true);
  assertions += 2;
  console.log(`Clarification fallback: ${assertions} runtime cases passed (HTTP 502/503/504, network, timeout, online result, content feedback, other ASK checks).`);
} finally {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  console.debug = originalDebug;
  await fs.rm(temp, { recursive: true, force: true });
}
