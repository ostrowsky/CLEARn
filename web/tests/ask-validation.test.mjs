import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const platformRoot = path.join(root, 'platform');
const require = createRequire(path.join(platformRoot, 'package.json'));
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const temp = await fs.mkdtemp(path.join(platformRoot, '.tmp-ask-validation-'));
const originalFetch = globalThis.fetch;
const originalDebug = console.debug;
const originalEnv = process.env.APP_ENV;
let caseCount = 0;
let fetchCount = 0;

try {
  process.env.APP_ENV = 'development';
  console.debug = () => {};
  const outfile = path.join(temp, 'checks.mjs');
  await build({
    stdin: {
      contents: `export { apiClient } from './apps/client/src/lib/api.ts'; export { staticContent } from './apps/client/src/lib/staticContent.ts'; export { PracticeService } from './apps/api/src/modules/practice/practice.service.ts';`,
      resolveDir: platformRoot,
      loader: 'ts',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    tsconfig: path.join(platformRoot, 'tsconfig.base.json'),
    plugins: [{
      name: 'test-config',
      setup(builder) {
        builder.onResolve({ filter: /^@clearn\/domain$/ }, () => ({ path: path.join(platformRoot, 'packages/domain/src/index.ts') }));
        builder.onResolve({ filter: /^\.\/config$/ }, args => args.importer.replaceAll('\\', '/').endsWith('/lib/api.ts') ? { path: 'api-config', namespace: 'test' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: "export const apiBaseUrl = 'https://api.clearn.test';", loader: 'js' }));
      },
    }],
  });
  const { apiClient, staticContent, PracticeService } = await import(pathToFileURL(outfile).href);
  const service = new PracticeService({ getContent: async () => staticContent });
  const clarify = { userQuestion: 'Sorry, the bug is only reproducible on what?', expectedQuestion: 'Sorry, the bug is only reproducible on what?' };
  const formation = { sentence: 'Stakeholders will review return on investment at the end of the year.', answer: 'return on investment', whWord: 'What', expectedQuestion: 'What will stakeholders review?', acceptedQuestions: ['What will they review?'], userQuestion: 'What will they review?' };
  const after = { question: 'You mentioned release timing. Could you explain that in a bit more detail?', detail: 'release timing', contextPhrase: 'You mentioned', followUpPhrase: 'Could you explain that in a bit more detail?' };
  const cases = [
    ['checkClarify', clarify, true],
    ['checkClarify', { ...clarify, userQuestion: 'sorry the bug is only reproducible on what' }, true],
    ['checkClarify', { userQuestion: "Sorry, you've assigned the ticket to who?", expectedQuestion: 'Sorry, you have assigned the ticket to who?' }, true],
    ['checkClarify', { ...clarify, userQuestion: 'Could you repeat the last part?', acceptedAnswers: ['Could you repeat the last part?'] }, true],
    ['checkClarify', { ...clarify, userQuestion: 'Sorry, the bug is reproducible where?' }, false],
    ['checkClarify', { ...clarify, userQuestion: '' }, false],
    ['checkClarify', { ...clarify, userQuestion: 'aaaaaa', expectedQuestion: 'aaaaaa' }, false],
    ['checkClarify', { ...clarify, userQuestion: 'zxqwr', expectedQuestion: 'zxqwr' }, false],
    ['checkAskAfter', after, true],
    ['checkAskAfter', { ...after, question: 'You highlighted release timing. Would you elaborate?', contextPhrase: 'You highlighted', followUpPhrase: 'Would you elaborate?' }, true],
    ['checkAskAfter', { question: 'You mentioned the rollout. Could you explain the main risk?' }, true],
    ['checkAskAfter', { ...after, question: '' }, false],
    ['checkAskAfter', { ...after, detail: 'aaaaaa' }, false],
    ['checkAskAfter', { ...after, question: 'The release will happen tomorrow.' }, false],
    ['checkAskAfter', { question: 'Could you explain the release?' }, false],
    ['checkAskAfter', { question: 'You mentioned the release?' }, false],
    ['checkQuestionFormation', formation, true],
    ['checkQuestionFormation', { ...formation, userQuestion: 'What will stakeholders review?' }, true],
    ['checkQuestionFormation', { ...formation, userQuestion: 'what will they review' }, true],
    ['checkQuestionFormation', { ...formation, userQuestion: 'What they review?' }, false],
    ['checkQuestionFormation', { ...formation, userQuestion: 'What will they reviewed?' }, false],
    ['checkQuestionFormation', { ...formation, userQuestion: 'What will stakeholders review return on investment?' }, false],
    ['checkQuestionFormation', { ...formation, userQuestion: 'What will stakeholders review bananas?' }, false],
    ['checkQuestionFormation', { ...formation, userQuestion: 'When will stakeholders review?' }, false],
    ['checkQuestionFormation', { ...formation, userQuestion: '' }, false],
    ['checkQuestionFormation', { sentence: 'The backend team fixed six API defects in staging yesterday.', answer: 'backend team', whWord: 'Who', expectedQuestion: 'Who fixed six API defects in staging yesterday?', acceptedQuestions: ['Who fixed it yesterday?'], userQuestion: 'Who fixed it yesterday?' }, true],
    ['checkQuestionFormation', { sentence: 'The backend team fixed six API defects in staging yesterday.', answer: 'backend team', whWord: 'Who', expectedQuestion: 'Who fixed six API defects in staging yesterday?', acceptedQuestions: ['Who fixed it yesterday?'], userQuestion: 'Who did fix it yesterday?' }, true],
  ];
  const modes = {
    online: () => Response.json({ accepted: false, feedback: 'Must never call the server.' }),
    suspended: () => new Response('Service Suspended', { status: 503, headers: { 'Content-Type': 'text/html' } }),
    offline: () => { throw new TypeError('Failed to fetch'); },
    stalled: () => new Promise(() => {}),
  };
  for (const [mode, responder] of Object.entries(modes)) {
    fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; return responder(); };
    for (const [method, payload, expected] of cases) {
      let timer;
      const result = await Promise.race([
        apiClient[method](payload),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${method} waited for the API in ${mode} mode`)), 250); }),
      ]).finally(() => clearTimeout(timer));
      assert.equal(result.accepted, expected, `${mode} ${method}: ${JSON.stringify(payload)}`);
      assert.deepEqual(result, await service[method](payload), `Client/API parity: ${mode} ${method}`);
      assert.ok(result.feedback, 'Every attempt must give feedback');
      caseCount++;
    }
    assert.equal(fetchCount, 0, `ASK checking must not make network or debug requests in ${mode} mode`);
  }

  const custom = structuredClone(staticContent);
  for (const key of ['clarifyFeedback', 'askAfterFeedback', 'questionFormationFeedback']) custom.meta.practice[key].accepted = `Admin ${key}`;
  globalThis.fetch = async url => String(url).endsWith('/api/debug/log') ? new Response(null, { status: 204 }) : Response.json(custom);
  await apiClient.getContent();
  fetchCount = 0;
  globalThis.fetch = async () => { fetchCount++; throw new TypeError('Failed to fetch'); };
  for (const [method, payload, key] of [['checkClarify', clarify, 'clarifyFeedback'], ['checkAskAfter', after, 'askAfterFeedback'], ['checkQuestionFormation', formation, 'questionFormationFeedback']]) {
    assert.equal((await apiClient[method](payload)).feedback, `Admin ${key}`);
    caseCount++;
  }
  assert.equal(fetchCount, 0);
  assert.deepEqual(await apiClient.getContent(), custom, 'A content fetch failure must retain the last good content');
  console.log(`Browser ASK validation: ${caseCount} cases passed; zero validation requests in online, 503, offline and stalled modes; real API service parity and admin feedback verified.`);
} finally {
  globalThis.fetch = originalFetch;
  console.debug = originalDebug;
  if (originalEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = originalEnv;
  await fs.rm(temp, { recursive: true, force: true });
}
