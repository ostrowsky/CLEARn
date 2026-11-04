import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'platform/package.json'));
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const temp = await fs.mkdtemp(path.join(root, 'platform/.tmp-ga-tests-'));
let serial = 0;
const KEY = 'clearn.analytics.consent.v1';
const ID = 'G-5EJ2691BS9';
function environment(href = 'https://clearn.me/asking?utm_source=newsletter&utm_medium=email&utm_campaign=autumn&email=private@example.com&answer=PRIVATE#SECRET') {
  const storage = new Map(); const scripts = []; const cookies = [];
  globalThis.window = { location: new URL(href), localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  globalThis.document = { referrer: 'https://search.example/results?private=SECRET', createElement: () => ({}), head: { appendChild: script => scripts.push(script) }, getElementById: id => scripts.find(script => script.id === id) };
  Object.defineProperty(document, 'cookie', { get: () => '_ga=abc; _ga_5EJ2691BS9=xyz; session=keep', set: value => cookies.push(value) });
  return { storage, scripts, cookies, commands: () => (window.dataLayer || []).map(item => Array.from(item)), events: () => (window.dataLayer || []).map(item => Array.from(item)).filter(item => item[0] === 'event') };
}
async function fresh() { return import(pathToFileURL(path.join(temp, 'web.mjs')).href + '?case=' + serial++); }
try {
  for (const [name, source] of [['web', 'analytics.web.ts'], ['native', 'analytics.ts']]) await build({ entryPoints: [path.join(root, 'platform/apps/client/src/lib', source)], outfile: path.join(temp, name + '.mjs'), bundle: true, format: 'esm', platform: 'browser' });
  delete globalThis.window; delete globalThis.document;
  let ga = await fresh(); assert.equal(ga.analyticsAvailable(), false); ga.setAnalyticsPage('/asking'); ga.trackExerciseEvent('answer_check', 'clarification', true);
  let env = environment(); ga = await fresh();
  ga.restoreAnalyticsConsent(); ga.setAnalyticsPage('/asking'); ga.trackExerciseEvent('answer_check', 'clarification', true);
  assert.equal(env.scripts.length, 0); assert.deepEqual(env.events(), []);
  ga.setAnalyticsConsent('denied'); assert.equal(env.scripts.length, 0);
  ga.setAnalyticsConsent('granted');
  assert.equal(env.scripts.length, 1); assert.equal(env.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + ID);
  assert.equal(env.events().length, 1); assert.equal(env.events()[0][1], 'page_view');
  const config = env.commands().find(item => item[0] === 'config');
  assert.equal(config[2].send_page_view, false); assert.equal(config[2].allow_google_signals, false); assert.equal(config[2].allow_ad_personalization_signals, false);
  assert.equal(config[2].page_referrer, 'https://search.example/');
  const defaults = env.commands().find(item => item[0] === 'consent' && item[1] === 'default');
  assert.equal(defaults[2].analytics_storage, 'denied'); assert.equal(defaults[2].ad_user_data, 'denied');
  ga.setAnalyticsPage('/asking'); assert.equal(env.events().length, 1);
  window.location = new URL('https://clearn.me/asking/interrupt?email=HIDDEN#SECRET');
  ga.setAnalyticsPage('/asking/interrupt'); ga.setAnalyticsPage('/asking/interrupt');
  assert.equal(env.events().filter(item => item[1] === 'page_view').length, 2);
  assert.ok(env.events()[1][2].page_referrer.startsWith('https://clearn.me/asking?utm_source='));
  ga.trackExerciseEvent('answer_check', 'clarification', true, { answer: 'PRIVATE' });
  assert.deepEqual(Object.keys(env.events().at(-1)[2]).sort(), ['correct', 'exercise_type', 'page_location', 'page_title', 'send_to']);
  assert.equal(env.events().at(-1)[2].correct, true);
  const count = env.events().length;
  ga.trackExerciseEvent('RAW_ANSWER', 'clarification', false); ga.trackExerciseEvent('answer_check', 'PRIVATE', false);
  assert.equal(env.events().length, count);
  ga.setAnalyticsPage('/admin'); ga.trackExerciseEvent('hint_view', 'clarification'); assert.equal(window['ga-disable-' + ID], true); assert.equal(env.events().length, count);
  ga.setAnalyticsPage('/asking/interrupt'); assert.equal(env.events().length, count + 1);
  ga.setAnalyticsPage('/asking/after-talk'); ga.setAnalyticsPage('/asking/interrupt'); assert.equal(env.events().length, count + 3);
  assert.doesNotMatch(JSON.stringify(env.commands()), /PRIVATE|SECRET|HIDDEN|private@example|results|\/admin/);
  ga.setAnalyticsConsent('denied'); ga.trackExerciseEvent('hint_view', 'clarification'); assert.deepEqual(env.events(), []); assert.equal(window['ga-disable-' + ID], true);
  assert.ok(env.cookies.some(value => value.startsWith('_ga='))); assert.ok(!env.cookies.some(value => value.startsWith('session=')));
  ga.setAnalyticsConsent('granted'); assert.equal(env.scripts.length, 1); assert.equal(env.events().length, 1); env.scripts[0].onerror();
  for (const href of ['http://localhost:8081', 'https://preview.vercel.app', 'http://clearn.me']) {
    env = environment(href); ga = await fresh(); ga.setAnalyticsPage('/asking'); ga.setAnalyticsConsent('granted'); assert.equal(env.scripts.length, 0);
  }
  env = environment(); ga = await fresh(); env.storage.set(KEY, JSON.stringify({choice:'granted',at:Date.now()-1000}));
  const original = env.storage.get(KEY); assert.equal(ga.restoreAnalyticsConsent(), 'granted'); assert.equal(env.scripts.length, 0, 'No phantom root view before pathname is known');
  ga.setAnalyticsPage('/asking'); assert.equal(env.events().length, 1); assert.equal(env.storage.get(KEY), original, 'Restoring consent must not extend expiry');
  env.storage.set(KEY, JSON.stringify({choice:'denied',at:Date.now()})); ga.restoreAnalyticsConsent(); assert.equal(window['ga-disable-' + ID], true); assert.deepEqual(env.events(), []);
  for (const value of ['invalid', JSON.stringify({choice:'yes',at:Date.now()}), JSON.stringify({choice:'granted',at:Date.now()+60000}), JSON.stringify({choice:'granted',at:Date.now()-181*86400000})]) {
    env.storage.set(KEY,value); assert.equal(ga.getAnalyticsConsent(), null);
  }
  env = environment(); ga = await fresh(); window.localStorage.getItem = () => {throw Error('blocked');}; window.localStorage.setItem = () => {throw Error('blocked');};
  assert.equal(ga.getAnalyticsConsent(), null); ga.setAnalyticsPage('/asking'); ga.setAnalyticsConsent('granted'); assert.equal(env.scripts.length, 1);
  window.gtag = () => {throw Error('blocked tag');}; ga.trackExerciseEvent('hint_view','question_formation');
  env = environment('https://clearn.me/asking?utm_source=private%40example.com&utm_campaign=https://secret'); ga = await fresh(); ga.setAnalyticsPage('/asking'); ga.setAnalyticsConsent('granted'); assert.doesNotMatch(JSON.stringify(env.commands()), /utm_|secret|private%40/);
  delete globalThis.window; delete globalThis.document;
  const native = await import(pathToFileURL(path.join(temp, 'native.mjs')).href); native.setAnalyticsConsent('granted'); native.setAnalyticsPage('/asking'); native.trackExerciseEvent('answer_check','clarification',true); assert.equal(native.analyticsAvailable(),false);
  const api = await fs.readFile(path.join(root,'platform/apps/client/src/lib/api.ts'),'utf8');
  for (const type of ['clarification','ask_after_talk','question_formation']) assert.ok(api.includes("trackExerciseEvent('answer_check', '" + type + "', result.accepted)"));
  const admin = await fs.readFile(path.join(root,'platform/apps/client/src/lib/adminContent.ts'),'utf8'); assert.ok(admin.includes('/^analytics\\./'));
  console.log('GA4 runtime tests passed: consent, expiry, script idempotency, safe payloads, SPA, admin/host exclusion, revoke, blocked storage/tag, native no-op and action wiring.');
} finally { delete globalThis.window; delete globalThis.document; await fs.rm(temp, {recursive:true,force:true}); }
