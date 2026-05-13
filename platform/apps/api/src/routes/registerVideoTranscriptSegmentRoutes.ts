import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';

type TranscriptSegment = {
  start: number;
  duration: number;
  text: string;
};

type VideoInfo = {
  id: string;
  start: number;
  end: number;
};

type PythonTranscriptAttempt = {
  command: string;
  text: string;
  error: string;
};

type TranscriptFetchResult = {
  text: string;
  provider: string;
  diagnostics?: Record<string, unknown>;
  error?: string;
};

type TranscriptFetcher = {
  name: string;
  fetch(info: VideoInfo): Promise<TranscriptFetchResult>;
};

const youTubeIdPattern = /^[A-Za-z0-9_-]{6,}$/;
const youTubeLegacyPattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
const transcriptLanguages = ['ru', 'ru-RU', 'en', 'en-US', 'en-GB'];
const youtubeUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
const innertubeClientVersion = '20.10.38';
const innertubeUserAgent = `com.google.android.youtube/${innertubeClientVersion} (Linux; U; Android 14)`;
const innertubeApiKeyPattern = /"INNERTUBE_API_KEY":\s*"([A-Za-z0-9_-]+)"/;
const youtubeConsentValuePattern = /name="v"\s+value="([^"]+)"/;
const routeDir = path.dirname(fileURLToPath(import.meta.url));
const pythonTranscriptScriptPath = path.resolve(routeDir, '..', '..', 'scripts', 'fetch-youtube-transcript.py');
const youtubeTranscriptProxyEnvNames = [
  'YOUTUBE_TRANSCRIPT_PROXY_URL',
  'YOUTUBE_TRANSCRIPT_HTTP_PROXY',
  'YOUTUBE_TRANSCRIPT_HTTPS_PROXY',
  'YOUTUBE_TRANSCRIPT_WEBSHARE_USERNAME',
  'YOUTUBE_TRANSCRIPT_WEBSHARE_PASSWORD',
];

function isYouTubeTranscriptProxyConfigured() {
  return youtubeTranscriptProxyEnvNames.some((name) => Boolean(process.env[name]?.trim()));
}

function isHostedIpBlockedError(error: string) {
  return /blocking requests from your IP|cloud provider|IP has been blocked/i.test(error);
}

function getYouTubeTranscriptFailureMessage(attempts: PythonTranscriptAttempt[]) {
  const blockedAttempt = attempts.find((attempt) => isHostedIpBlockedError(attempt.error));
  if (blockedAttempt) {
    return isYouTubeTranscriptProxyConfigured()
      ? 'YouTube blocked transcript requests from the configured API proxy. Rotate the proxy or update the YouTube transcript proxy settings, then retry Fetch transcript.'
      : 'YouTube blocked transcript requests from the hosted API IP. Configure YOUTUBE_TRANSCRIPT_PROXY_URL or YOUTUBE_TRANSCRIPT_WEBSHARE_USERNAME/YOUTUBE_TRANSCRIPT_WEBSHARE_PASSWORD on the API host, then retry Fetch transcript.';
  }

  const firstError = attempts.map((attempt) => attempt.error).find((error) => error.trim());
  return firstError || 'Transcript for the selected YouTube segment was not found.';
}

function parseBrowserlessPayload(payload: unknown): { text: string; error: string; diagnostics?: Record<string, unknown> } {
  const record = asRecord(payload);
  const directText = typeof record.text === 'string' ? record.text.trim() : '';
  if (directText) {
    return { text: directText, error: '', diagnostics: asRecord(record.diagnostics) };
  }

  const data = record.data;
  if (data && typeof data === 'object') {
    return parseBrowserlessPayload(data);
  }

  const result = record.result;
  if (result && typeof result === 'object') {
    return parseBrowserlessPayload(result);
  }

  const error = typeof record.error === 'string'
    ? record.error.trim()
    : typeof record.message === 'string'
      ? record.message.trim()
      : '';
  return { text: '', error, diagnostics: asRecord(record.diagnostics) };
}

function getBrowserlessFunctionCode() {
  return `export default async function ({ page, context }) {
  const videoId = String(context.videoId || '');
  const start = Number(context.start || 0);
  const end = Number(context.end || (start + 45));
  const languages = Array.isArray(context.languages) ? context.languages : ['ru', 'ru-RU', 'en', 'en-US', 'en-GB'];

  function cleanText(value) {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function parseJson3(payload) {
    const events = Array.isArray(payload && payload.events) ? payload.events : [];
    return events.map((event) => ({
      start: Number(event.tStartMs || 0) / 1000,
      duration: Number(event.dDurationMs || 0) / 1000,
      text: Array.isArray(event.segs) ? event.segs.map((seg) => String(seg.utf8 || '')).join('').replace(/\\s+/g, ' ').trim() : '',
    })).filter((segment) => segment.text);
  }

  function parseXml(payload) {
    const source = String(payload || '');
    const rich = source.match(/<p\\s+[^>]*>[\\s\\S]*?<\\/p>/g) || [];
    const richSegments = rich.map((item) => ({
      start: Number.parseInt((item.match(/\\bt="([^"]+)"/) || [])[1] || '0', 10) / 1000,
      duration: Number.parseInt((item.match(/\\bd="([^"]+)"/) || [])[1] || '0', 10) / 1000,
      text: cleanText(item),
    })).filter((segment) => Number.isFinite(segment.start) && segment.text);
    if (richSegments.length) return richSegments;

    return (source.match(/<text\\b[^>]*>[\\s\\S]*?<\\/text>/g) || []).map((item) => ({
      start: Number.parseFloat((item.match(/\\bstart="([^"]+)"/) || [])[1] || '0'),
      duration: Number.parseFloat((item.match(/\\bdur="([^"]+)"/) || [])[1] || '0'),
      text: cleanText(item),
    })).filter((segment) => Number.isFinite(segment.start) && segment.text);
  }

  function getCaptionTracks(playerResponse) {
    return (((playerResponse || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
  }

  function chooseTrack(tracks) {
    const available = Array.isArray(tracks) ? tracks.filter((track) => track && track.baseUrl) : [];
    for (const language of languages) {
      const exact = available.find((track) => String(track.languageCode || '').toLowerCase() === String(language).toLowerCase());
      if (exact) return exact;
    }
    return available.find((track) => String(track.languageCode || '').toLowerCase().startsWith('ru'))
      || available.find((track) => String(track.languageCode || '').toLowerCase().startsWith('en'))
      || available.find((track) => String(track.kind || '').toLowerCase() === 'asr')
      || available[0];
  }

  await page.goto('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId) + '&hl=en', {
    waitUntil: 'domcontentloaded',
    timeout: Math.min(Number(context.timeoutMs || 90000), 90000),
  });

  const result = await page.evaluate(async ({ start, end }) => {
    const playerResponse = window.ytInitialPlayerResponse || {};
    const tracks = (((playerResponse || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || [];
    return { tracks };
  }, { start, end });

  const track = chooseTrack(result.tracks);
  if (!track || !track.baseUrl) {
    return { text: '', error: 'Browserless could not find YouTube caption tracks.', diagnostics: { trackCount: Array.isArray(result.tracks) ? result.tracks.length : 0 } };
  }

  const trackUrl = new URL(String(track.baseUrl).replace(/&amp;/g, '&'));
  trackUrl.searchParams.set('fmt', 'json3');
  const raw = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { ok: response.ok, status: response.status, text: await response.text() };
  }, trackUrl.toString());

  if (!raw.ok || !raw.text) {
    return { text: '', error: 'Browserless could not download YouTube caption track.', diagnostics: { status: raw.status, languageCode: track.languageCode || '' } };
  }

  let segments = [];
  try {
    segments = parseJson3(JSON.parse(raw.text));
  } catch {
    segments = parseXml(raw.text);
  }

  const selected = segments.filter((segment) => segment.start >= start && segment.start < end);
  return {
    text: selected.map((segment) => segment.text).join(' ').replace(/\\s+/g, ' ').trim(),
    diagnostics: { provider: 'browserless', languageCode: track.languageCode || '', segmentCount: segments.length, selectedCount: selected.length },
  };
}`;
}

function buildBrowserlessFunctionUrl() {
  const endpoint = new URL('function', `${env.BROWSERLESS_API_URL.replace(/\/+$/, '')}/`);
  if (env.BROWSERLESS_API_KEY?.trim()) {
    endpoint.searchParams.set('token', env.BROWSERLESS_API_KEY.trim());
  }
  if (env.BROWSERLESS_USE_RESIDENTIAL_PROXY) {
    endpoint.searchParams.set('proxy', 'residential');
    endpoint.searchParams.set('proxyCountry', env.BROWSERLESS_PROXY_COUNTRY || 'us');
  }
  return endpoint.toString();
}

async function fetchBrowserlessTranscriptSegment(info: VideoInfo): Promise<TranscriptFetchResult> {
  if (!env.BROWSERLESS_API_KEY?.trim()) {
    return { provider: 'browserless', text: '', error: 'BROWSERLESS_API_KEY is not configured.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.TRANSCRIPT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(buildBrowserlessFunctionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        code: getBrowserlessFunctionCode(),
        context: {
          videoId: info.id,
          start: info.start,
          end: info.end > info.start ? info.end : info.start + 45,
          languages: transcriptLanguages,
          timeoutMs: env.TRANSCRIPT_FETCH_TIMEOUT_MS,
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    const parsed = parseBrowserlessPayload(payload);
    if (!response.ok) {
      return { provider: 'browserless', text: '', error: parsed.error || `Browserless transcript fetch failed with HTTP ${response.status}.`, diagnostics: parsed.diagnostics };
    }

    return { provider: 'browserless', text: parsed.text, error: parsed.error, diagnostics: parsed.diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: 'browserless', text: '', error: `Browserless transcript fetch failed: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

function parseSeconds(value: string) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return 0;

  const colonParts = clean.split(':').map((item) => Number.parseInt(item, 10));
  if (colonParts.length > 1 && colonParts.every((item) => Number.isFinite(item))) {
    return colonParts.reduce((total, part) => (total * 60) + part, 0);
  }

  const explicit = clean.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (explicit && (explicit[1] || explicit[2] || explicit[3])) {
    return (Number.parseInt(explicit[1] || '0', 10) * 3600)
      + (Number.parseInt(explicit[2] || '0', 10) * 60)
      + Number.parseInt(explicit[3] || '0', 10);
  }

  const numeric = Number.parseInt(clean, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getYouTubeVideoInfo(url: string): VideoInfo | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let id = '';

    if (host === 'youtu.be') {
      id = parsed.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname === '/watch') {
        id = parsed.searchParams.get('v') || '';
      } else {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (['embed', 'shorts', 'live'].includes(parts[0] || '')) {
          id = parts[1] || '';
        }
      }
    }

    if (!youTubeIdPattern.test(id)) return null;

    const start = parseSeconds(parsed.searchParams.get('start') || parsed.searchParams.get('t') || '');
    const end = parseSeconds(parsed.searchParams.get('end') || '');
    return { id, start, end };
  } catch {
    const match = url.match(youTubeLegacyPattern);
    return match?.[1] ? { id: match[1], start: 0, end: 0 } : null;
  }
}

function decodeHtmlEntities(value: string) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(value: string) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseJson3Transcript(payload: unknown): TranscriptSegment[] {
  const events = asRecord(payload).events;
  if (!Array.isArray(events)) return [];

  return events
    .map((event) => {
      const record = asRecord(event);
      const segs = Array.isArray(record.segs) ? record.segs : [];
      const text = segs
        .map((seg) => asRecord(seg).utf8)
        .filter((item): item is string => typeof item === 'string')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      return {
        start: Number(record.tStartMs || 0) / 1000,
        duration: Number(record.dDurationMs || 0) / 1000,
        text,
      };
    })
    .filter((segment) => segment.text);
}

function parseXmlTranscript(payload: string): TranscriptSegment[] {
  const richMatches = payload.match(/<p\s+[^>]*>[\s\S]*?<\/p>/g) || [];
  const richSegments = richMatches
    .map((item) => {
      const start = Number.parseInt(item.match(/\bt="([^"]+)"/)?.[1] || '0', 10) / 1000;
      const duration = Number.parseInt(item.match(/\bd="([^"]+)"/)?.[1] || '0', 10) / 1000;
      const text = decodeHtmlEntities(stripTags(item)).replace(/\s+/g, ' ').trim();
      return { start, duration, text };
    })
    .filter((segment) => Number.isFinite(segment.start) && segment.text);
  if (richSegments.length) {
    return richSegments;
  }

  const matches = payload.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) || [];
  return matches
    .map((item) => {
      const start = Number.parseFloat(item.match(/\bstart="([^"]+)"/)?.[1] || '0');
      const duration = Number.parseFloat(item.match(/\bdur="([^"]+)"/)?.[1] || '0');
      const text = decodeHtmlEntities(stripTags(item)).replace(/\s+/g, ' ').trim();
      return { start, duration, text };
    })
    .filter((segment) => Number.isFinite(segment.start) && segment.text);
}

function extractBalancedJson(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;

  const start = source.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function getNestedRecord(source: unknown, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') return {};
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
}

function getCaptionTrackBaseUrl(playerResponse: Record<string, unknown>) {
  const trackList = getNestedRecord(playerResponse, ['captions', 'playerCaptionsTracklistRenderer']);
  const rawTracks = trackList.captionTracks;
  if (!Array.isArray(rawTracks)) return '';

  const tracks = rawTracks
    .map((track) => asRecord(track))
    .filter((track) => typeof track.baseUrl === 'string');

  const preferred = transcriptLanguages
    .map((language) => tracks.find((track) => String(track.languageCode || '').toLowerCase() === language.toLowerCase()))
    .find(Boolean)
    || tracks.find((track) => String(track.languageCode || '').toLowerCase().startsWith('ru'))
    || tracks.find((track) => String(track.languageCode || '').toLowerCase().startsWith('en'))
    || tracks.find((track) => String(track.kind || '').toLowerCase() === 'asr')
    || tracks[0];

  return typeof preferred?.baseUrl === 'string' ? preferred.baseUrl : '';
}

async function fetchWatchHtml(videoId: string, consentCookie = '') {
  const watchUrl = new URL('https://www.youtube.com/watch');
  watchUrl.searchParams.set('v', videoId);
  watchUrl.searchParams.set('hl', 'en');

  const headers: Record<string, string> = {
    'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
    'User-Agent': youtubeUserAgent,
  };
  if (consentCookie) {
    headers.Cookie = consentCookie;
  }

  const response = await fetch(watchUrl, {
    headers,
  });

  if (!response.ok) return null;

  const html = await response.text();
  if (!consentCookie && html.includes('action="https://consent.youtube.com/s"')) {
    const consentValue = html.match(youtubeConsentValuePattern)?.[1] || '';
    if (consentValue) {
      return fetchWatchHtml(videoId, `CONSENT=YES+${consentValue}`);
    }
  }

  return html;
}

function extractInnertubeApiKey(html: string) {
  return html.match(innertubeApiKeyPattern)?.[1] || '';
}

async function fetchWatchPlayerResponse(videoId: string) {
  const html = await fetchWatchHtml(videoId);
  if (!html) return null;

  const rawJson = extractBalancedJson(html, 'ytInitialPlayerResponse');
  if (!rawJson) return null;

  try {
    return JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchTimedTextTranscript(videoId: string) {
  for (const language of transcriptLanguages) {
    const transcriptUrl = new URL('https://www.youtube.com/api/timedtext');
    transcriptUrl.searchParams.set('v', videoId);
    transcriptUrl.searchParams.set('lang', language);
    transcriptUrl.searchParams.set('fmt', 'json3');

    const response = await fetch(transcriptUrl, { headers: { 'User-Agent': youtubeUserAgent } });
    if (!response.ok) continue;

    const raw = await response.text();
    if (!raw.trim()) continue;

    try {
      const segments = parseJson3Transcript(JSON.parse(raw));
      if (segments.length) return segments;
    } catch {
      const segments = parseXmlTranscript(raw);
      if (segments.length) return segments;
    }
  }

  return [];
}

async function fetchInnertubePlayerResponse(videoId: string, apiKey = '') {
  const endpoint = new URL('https://www.youtube.com/youtubei/v1/player');
  endpoint.searchParams.set('prettyPrint', 'false');
  if (apiKey) {
    endpoint.searchParams.set('key', apiKey);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': innertubeUserAgent,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: innertubeClientVersion,
          hl: 'en',
          gl: 'US',
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });

  if (!response.ok) return null;
  return response.json() as Promise<Record<string, unknown>>;
}

async function fetchTranscriptTrack(trackUrl: string) {
  const transcriptUrl = new URL(decodeHtmlEntities(trackUrl));

  const response = await fetch(transcriptUrl, { headers: { 'User-Agent': youtubeUserAgent } });
  if (!response.ok) return [];

  const raw = await response.text();
  if (!raw.trim()) return [];

  try {
    return parseJson3Transcript(JSON.parse(raw));
  } catch {
    return parseXmlTranscript(raw);
  }
}

async function fetchTranscriptSegments(videoId: string) {
  const watchHtml = await fetchWatchHtml(videoId);
  const apiKey = watchHtml ? extractInnertubeApiKey(watchHtml) : '';
  const innertubeResponse = await fetchInnertubePlayerResponse(videoId, apiKey);
  const innerTubeBaseUrl = innertubeResponse ? getCaptionTrackBaseUrl(innertubeResponse) : '';
  if (innerTubeBaseUrl) {
    const segments = await fetchTranscriptTrack(innerTubeBaseUrl);
    if (segments.length) return segments;
  }

  let watchResponse: Record<string, unknown> | null = null;
  if (watchHtml) {
    const rawJson = extractBalancedJson(watchHtml, 'ytInitialPlayerResponse');
    if (rawJson) {
      try {
        watchResponse = JSON.parse(rawJson) as Record<string, unknown>;
      } catch {
        watchResponse = null;
      }
    }
  }
  if (!watchResponse) {
    watchResponse = await fetchWatchPlayerResponse(videoId);
  }
  const watchBaseUrl = watchResponse ? getCaptionTrackBaseUrl(watchResponse) : '';
  if (watchBaseUrl) {
    const segments = await fetchTranscriptTrack(watchBaseUrl);
    if (segments.length) return segments;
  }

  const timedTextSegments = await fetchTimedTextTranscript(videoId);
  if (timedTextSegments.length) return timedTextSegments;

  return [];
}

function pickTranscriptSegmentText(segments: TranscriptSegment[], start: number, end: number) {
  const segmentStart = Math.max(0, start || 0);
  const segmentEnd = end > segmentStart ? end : segmentStart + 45;

  const selected = segments.filter((item) => item.start >= segmentStart && item.start < segmentEnd);
  if (!selected.length) {
    return { text: '', start: segmentStart, end: segmentEnd };
  }

  return {
    text: selected.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim(),
    start: segmentStart,
    end: segmentEnd,
  };
}

function runPythonTranscriptHelper(command: string, info: VideoInfo) {
  return new Promise<PythonTranscriptAttempt>((resolve) => {
    const parseOutput = () => {
      try {
        const parsed = JSON.parse(stdout) as { text?: unknown; error?: unknown };
        return {
          text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
          error: typeof parsed.error === 'string' ? parsed.error.trim() : '',
        };
      } catch {
        return { text: stderr ? '' : stdout.trim(), error: stderr.trim() };
      }
    };

    const child = spawn(command, [pythonTranscriptScriptPath, info.id, String(info.start), String(info.end || info.start + 45)], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ command, text: '', error: 'Python transcript helper timed out.' });
    }, 30000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ command, text: '', error: `Unable to start ${command}.` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const parsed = parseOutput();
      if (code !== 0) {
        const error = parsed.error || stderr.trim() || stdout.trim() || `Python transcript helper exited with code ${code}.`;
        const proxyHint = !isYouTubeTranscriptProxyConfigured() && isHostedIpBlockedError(error)
          ? ' Configure YOUTUBE_TRANSCRIPT_PROXY_URL or YOUTUBE_TRANSCRIPT_WEBSHARE_USERNAME/YOUTUBE_TRANSCRIPT_WEBSHARE_PASSWORD for hosted environments.'
          : '';
        resolve({ command, text: '', error: `${error}${proxyHint}` });
        return;
      }

      resolve({ command, text: parsed.text, error: parsed.error });
    });
  });
}

async function fetchPythonTranscriptSegment(info: VideoInfo) {
  const attempts: PythonTranscriptAttempt[] = [];
  for (const command of ['python3', 'python']) {
    const attempt = await runPythonTranscriptHelper(command, info);
    attempts.push(attempt);
    if (attempt.text) return { text: attempt.text, attempts };
  }

  return { text: '', attempts };
}

function getTranscriptFetchers(): TranscriptFetcher[] {
  const directFetcher: TranscriptFetcher = {
    name: 'direct',
    async fetch(info) {
      const pythonTranscript = await fetchPythonTranscriptSegment(info);
      if (pythonTranscript.text) {
        return {
          provider: 'python',
          text: pythonTranscript.text,
          diagnostics: { python: pythonTranscript.attempts },
        };
      }

      const segments = await fetchTranscriptSegments(info.id);
      const picked = pickTranscriptSegmentText(segments, info.start, info.end);
      return {
        provider: 'direct',
        text: picked.text,
        error: picked.text ? '' : getYouTubeTranscriptFailureMessage(pythonTranscript.attempts),
        diagnostics: { python: pythonTranscript.attempts, typeScriptSegments: segments.length },
      };
    },
  };

  const browserlessFetcher: TranscriptFetcher = {
    name: 'browserless',
    fetch: fetchBrowserlessTranscriptSegment,
  };

  if (env.TRANSCRIPT_FETCH_PROVIDER === 'browserless') {
    return [browserlessFetcher, directFetcher];
  }
  if (env.TRANSCRIPT_FETCH_PROVIDER === 'direct') {
    return [directFetcher];
  }

  return env.BROWSERLESS_API_KEY?.trim()
    ? [browserlessFetcher, directFetcher]
    : [directFetcher];
}

async function fetchTranscriptWithProviders(info: VideoInfo) {
  const diagnostics: Array<TranscriptFetchResult & { provider: string }> = [];
  for (const fetcher of getTranscriptFetchers()) {
    const result = await fetcher.fetch(info);
    diagnostics.push({ ...result, provider: result.provider || fetcher.name });
    if (result.text.trim()) {
      return { text: result.text.trim(), provider: result.provider || fetcher.name, diagnostics };
    }
  }

  const firstError = diagnostics.map((item) => item.error).find((error) => error?.trim());
  return { text: '', provider: '', error: firstError || 'Transcript for the selected YouTube segment was not found.', diagnostics };
}

export async function registerVideoTranscriptSegmentRoutes(app: FastifyInstance) {
  const cache = new Map<string, { available: boolean; source: 'youtube' | 'unsupported'; text: string; start: number; end: number; message?: string }>();

  app.get('/api/media/youtube-transcript-segment', async (request, reply) => {
    const query = request.query as { url?: string; debug?: string };
    const url = String(query.url || '').trim();
    const includeDebug = String(query.debug || '') === '1';
    if (!url) {
      return reply.code(400).send({ available: false, source: 'unsupported', text: '', start: 0, end: 0, message: 'Video URL is required.' });
    }

    if (!includeDebug && cache.has(url)) {
      return cache.get(url);
    }

    const info = getYouTubeVideoInfo(url);
    if (!info) {
      return { available: false, source: 'unsupported', text: '', start: 0, end: 0, message: 'Unsupported video source.' };
    }

    try {
      const transcript = await fetchTranscriptWithProviders(info);
      const segmentStart = Math.max(0, info.start || 0);
      const segmentEnd = info.end > segmentStart ? info.end : segmentStart + 45;
      const result = {
        available: Boolean(transcript.text),
        source: 'youtube' as const,
        text: transcript.text,
        start: segmentStart,
        end: segmentEnd,
        ...(transcript.text ? {} : { message: transcript.error || 'Transcript for the selected YouTube segment was not found.' }),
        ...(includeDebug ? { diagnostics: { providers: transcript.diagnostics } } : {}),
      };

      if (!includeDebug) cache.set(url, result);
      if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        if (firstKey) cache.delete(firstKey);
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { available: false, source: 'youtube', text: '', start: info.start, end: info.end || info.start, message };
    }
  });
}
