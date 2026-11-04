import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const productionProbes = [
  { name: 'health', path: '/api/health', method: 'GET', status: 200, valid: v => object(v) && v.status === 'ok' },
  { name: 'content', path: '/api/content', method: 'GET', status: 200, valid: v => object(v) && object(v.meta) && Array.isArray(v.sections) && v.sections.length > 0 && v.sections.every(s => object(s) && typeof s.id === 'string' && Array.isArray(s.blocks)) },
  { name: 'admin-auth-status', path: '/api/admin/auth/status', method: 'GET', status: 200, valid: v => object(v) && typeof v.configured === 'boolean' && typeof v.authenticated === 'boolean' && v.authenticated === false },
  { name: 'admin-access-protected', path: '/api/admin/content', method: 'GET', status: 401, valid: v => object(v) && v.statusCode === 401 },
  { name: 'debug-access-protected', path: '/api/debug/logs', method: 'GET', status: 401, valid: v => object(v) && v.statusCode === 401 },
  { name: 'stt-cors-preflight', path: '/api/speech/stt', method: 'OPTIONS' },
  { name: 'tts-cors-preflight', path: '/api/speech/tts', method: 'OPTIONS' },
];
export function validateBaseUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('API base must be an HTTP(S) origin without credentials, path, query or fragment.');
  return url.origin;
}
export async function checkProductionApi({ baseUrl, origin = 'https://clearn.me', timeoutMs = 10000, fetchImpl = fetch }) {
  const base = validateBaseUrl(baseUrl);
  const learner = validateBaseUrl(origin);
  if (base === learner) throw new Error('The static learner origin is not the API origin.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('timeoutMs must be between 1 and 60000.');
  const results = [];
  // Sequential and read-only: no media/credentials/mutations/paid AI calls.
  for (const probe of productionProbes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    const result = { name: probe.name, path: probe.path, method: probe.method, ok: false, status: null, reasons: [] };
    try {
      const response = await fetchImpl(base + probe.path, {
        method: probe.method, redirect: 'manual', signal: controller.signal,
        headers: { Origin: learner, Accept: 'application/json', ...(probe.method === 'OPTIONS' ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } : {}) },
      });
      result.status = response.status;
      if (response.headers.get('access-control-allow-origin') !== learner) result.reasons.push('Missing or incorrect credentialed CORS origin');
      if (response.headers.get('access-control-allow-credentials') !== 'true') result.reasons.push('Missing credentialed CORS permission');
      if (probe.method === 'OPTIONS') {
        if (response.status < 200 || response.status >= 300) result.reasons.push('Preflight HTTP ' + response.status);
        const methods = (response.headers.get('access-control-allow-methods') || '').toUpperCase().split(/[, ]+/);
        const headers = (response.headers.get('access-control-allow-headers') || '').toLowerCase().split(/[, ]+/);
        if (!methods.includes('POST')) result.reasons.push('Preflight does not permit POST');
        if (!headers.includes('content-type')) result.reasons.push('Preflight does not permit content-type');
        await response.body?.cancel();
      } else {
        if (response.status !== probe.status) result.reasons.push('HTTP ' + response.status + ', expected ' + probe.status);
        if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(response.headers.get('content-type') || '')) result.reasons.push('Expected JSON, not HTML/other content');
        let value;
        try { value = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; result.reasons.push('Invalid JSON'); }
        if (value !== undefined && !probe.valid(value)) result.reasons.push('Response contract mismatch');
      }
      result.ok = result.reasons.length === 0;
    } catch (error) {
      result.reasons.push(controller.signal.aborted ? 'Request/body timed out' : 'Network or response failure: ' + (error instanceof Error ? error.name : 'unknown'));
    } finally { clearTimeout(timer); }
    result.elapsedMs = Date.now() - started;
    results.push(result);
  }
  return { checkedAt: new Date().toISOString(), baseUrl: base, origin: learner, ok: results.every(v => v.ok), results,
    unverified: ['Actual STT transcription', 'Actual TTS generation', 'LLM generation/quality', 'Authenticated admin mutations/backups', 'Redis/session continuity', 'YouTube/provider availability'] };
}
export function formatSummary(report) {
  return ['## Production API: ' + (report.ok ? 'basic checks passed (provider execution unverified)' : 'UNHEALTHY'), '',
    '| Probe | HTTP | Result |', '|---|---|---|', ...report.results.map(v => '| ' + v.method + ' ' + v.path + ' | ' + (v.status ?? 'network') + ' | ' + (v.ok ? 'PASS' : v.reasons.join('; ')) + ' |'), '',
    'Not tested (not a speech/AI readiness claim): ' + report.unverified.join(', ') + '.', ''].join('\n');
}
async function main() {
  const config = JSON.parse(await fs.readFile(path.join(repository, 'vercel.json'), 'utf8'));
  const report = await checkProductionApi({ baseUrl: process.env.PRODUCTION_API_BASE_URL || config.build.env.EXPO_PUBLIC_API_BASE_URL, origin: process.env.PRODUCTION_WEB_ORIGIN || 'https://clearn.me', timeoutMs: Number(process.env.API_SMOKE_TIMEOUT_MS || 10000) });
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, formatSummary(report));
  if (process.env.API_SMOKE_REPORT_PATH) await fs.writeFile(process.env.API_SMOKE_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.ok ? 0 : 1;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error('Production API check failed:', error.message); process.exitCode = 1; });
