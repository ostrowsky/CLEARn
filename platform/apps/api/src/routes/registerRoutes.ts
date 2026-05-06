import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { AnsweringSession, CoachChatSession } from '@softskills/domain';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { BackupService } from '../modules/backup/backup.service';
import { FileSystemContentRepository } from '../modules/content/content.repository';
import { ContentService } from '../modules/content/content.service';
import { LocalMediaStore, resolveLocalUploadPath } from '../modules/content/media.store';
import { PracticeService } from '../modules/practice/practice.service';
import { AnsweringSessionService } from '../modules/session/answering.service';
import { CoachChatSessionService } from '../modules/session/coach.service';
import { InMemorySessionStore, RedisSessionStore } from '../modules/session/session.store';
import { SpeechService } from '../modules/speech/speech.service';

type DebugLogEntry = {
  id: string;
  timestamp: string;
  scope: string;
  event: string;
  details: Record<string, unknown>;
};

type VideoTranscriptSegment = {
  start: number;
  duration: number;
  text: string;
};

type VideoTranscriptResult = {
  available: boolean;
  source: 'youtube' | 'unsupported';
  text: string;
  start: number;
  end: number;
  message?: string;
};

const youTubeIdPattern = /^[A-Za-z0-9_-]{6,}$/;
const youTubeLegacyPattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;

function getContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.opus':
      return 'audio/opus';
    default:
      return 'application/octet-stream';
  }
}

function parseRangeHeader(rangeHeader: string | undefined, size: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }

  const rawStart = match[1] || '';
  const rawEnd = match[2] || '';
  if (!rawStart && !rawEnd) {
    return null;
  }

  const start = rawStart ? Number.parseInt(rawStart, 10) : Math.max(size - Number.parseInt(rawEnd, 10), 0);
  const end = rawEnd && rawStart ? Number.parseInt(rawEnd, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function parseSeconds(value: string) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) {
    return 0;
  }

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

function getYouTubeVideoInfo(url: string) {
  if (!url) {
    return null;
  }

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

    if (!youTubeIdPattern.test(id)) {
      return null;
    }

    const start = parseSeconds(parsed.searchParams.get('start') || parsed.searchParams.get('t') || '');
    return { id, start };
  } catch {
    const match = url.match(youTubeLegacyPattern);
    return match?.[1] ? { id: match[1], start: 0 } : null;
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

function extractJsonObjectAfterMarker(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const start = source.indexOf('{', markerIndex);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parsePlayerResponse(html: string) {
  const json = extractJsonObjectAfterMarker(html, 'ytInitialPlayerResponse');
  if (!json) {
    return null;
  }

  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getNestedRecord(source: unknown, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return {};
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
}

function getCaptionTrackBaseUrl(playerResponse: Record<string, unknown>) {
  const trackList = getNestedRecord(playerResponse, ['captions', 'playerCaptionsTracklistRenderer']);
  const rawTracks = trackList.captionTracks;
  if (!Array.isArray(rawTracks)) {
    return '';
  }

  const tracks = rawTracks
    .map((track) => asRecord(track))
    .filter((track) => typeof track.baseUrl === 'string');
  const preferred = tracks.find((track) => String(track.languageCode || '').toLowerCase().startsWith('en'))
    || tracks.find((track) => String(track.kind || '').toLowerCase() === 'asr')
    || tracks[0];

  return typeof preferred?.baseUrl === 'string' ? preferred.baseUrl : '';
}

function parseJson3Transcript(payload: unknown): VideoTranscriptSegment[] {
  const events = asRecord(payload).events;
  if (!Array.isArray(events)) {
    return [];
  }

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

function parseXmlTranscript(payload: string): VideoTranscriptSegment[] {
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

async function fetchTranscriptTrack(trackUrl: string) {
  const transcriptUrl = new URL(decodeHtmlEntities(trackUrl));
  transcriptUrl.searchParams.set('fmt', 'json3');
  const transcriptResponse = await fetch(transcriptUrl);
  if (!transcriptResponse.ok) {
    return [];
  }

  const raw = await transcriptResponse.text();
  if (!raw.trim()) {
    return [];
  }

  try {
    return parseJson3Transcript(JSON.parse(raw));
  } catch {
    return parseXmlTranscript(raw);
  }
}

async function fetchTimedTextTranscript(videoId: string) {
  for (const language of ['en', 'en-US', 'en-GB']) {
    const transcriptUrl = new URL('https://www.youtube.com/api/timedtext');
    transcriptUrl.searchParams.set('v', videoId);
    transcriptUrl.searchParams.set('lang', language);
    transcriptUrl.searchParams.set('fmt', 'json3');
    const response = await fetch(transcriptUrl);
    if (!response.ok) {
      continue;
    }

    const raw = await response.text();
    if (!raw.trim()) {
      continue;
    }

    try {
      const segments = parseJson3Transcript(JSON.parse(raw));
      if (segments.length) {
        return segments;
      }
    } catch {
      const segments = parseXmlTranscript(raw);
      if (segments.length) {
        return segments;
      }
    }
  }

  return [];
}

async function fetchInnertubePlayerResponse(videoId: string) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 SOFTskills transcript fetcher',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20250502.00.00',
          hl: 'en',
          gl: 'US',
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });

  if (!response.ok) {
    return null;
  }

  return response.json() as Promise<Record<string, unknown>>;
}

function pickTranscriptSegmentText(segments: VideoTranscriptSegment[], start: number, windowSeconds = 45) {
  if (!segments.length) {
    return { text: '', start, end: start };
  }

  const windowStart = Math.max(0, start - 2);
  const windowEnd = windowStart + windowSeconds;
  let selected = segments.filter((segment) => {
    const segmentEnd = segment.start + Math.max(segment.duration, 1);
    return segmentEnd >= windowStart && segment.start <= windowEnd;
  });

  if (!selected.length) {
    selected = segments.slice(0, 6);
  }

  const first = selected[0];
  const last = selected[selected.length - 1];
  return {
    text: selected.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
    start: first?.start ?? start,
    end: (last?.start ?? start) + Math.max(last?.duration ?? 0, 0),
  };
}

function unavailableYouTubeTranscript(start: number, message: string): VideoTranscriptResult {
  return {
    available: false,
    source: 'youtube',
    text: '',
    start,
    end: start,
    message,
  };
}

async function fetchYouTubeTranscript(url: string): Promise<VideoTranscriptResult> {
  const info = getYouTubeVideoInfo(url);
  if (!info) {
    return { available: false, source: 'unsupported', text: '', start: 0, end: 0, message: 'Unsupported video source.' };
  }

  let segments = await fetchTimedTextTranscript(info.id);
  if (!segments.length) {
    const innertubeResponse = await fetchInnertubePlayerResponse(info.id);
    const innertubeBaseUrl = innertubeResponse ? getCaptionTrackBaseUrl(innertubeResponse) : '';
    if (innertubeBaseUrl) {
      segments = await fetchTranscriptTrack(innertubeBaseUrl);
    }
  }

  if (segments.length) {
    const picked = pickTranscriptSegmentText(segments, info.start);
    return {
      available: Boolean(picked.text),
      source: 'youtube',
      text: picked.text,
      start: picked.start,
      end: picked.end,
      ...(picked.text ? {} : { message: 'No transcript text was found for this segment.' }),
    };
  }

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(info.id)}`;
  const watchResponse = await fetch(watchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 SOFTskills transcript fetcher',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!watchResponse.ok) {
    return unavailableYouTubeTranscript(
      info.start,
      `YouTube shows the transcript in the browser, but did not expose it to this server request (${watchResponse.status}). Add the segment text to the material Transcript field in admin.`,
    );
  }

  const playerResponse = parsePlayerResponse(await watchResponse.text());
  const baseUrl = playerResponse ? getCaptionTrackBaseUrl(playerResponse) : '';
  if (!baseUrl) {
    return unavailableYouTubeTranscript(
      info.start,
      'YouTube did not expose a public transcript track to the server. Add the segment text to the material Transcript field in admin.',
    );
  }

  const transcriptUrl = new URL(decodeHtmlEntities(baseUrl));
  transcriptUrl.searchParams.set('fmt', 'json3');
  segments = await fetchTranscriptTrack(transcriptUrl.toString());

  const picked = pickTranscriptSegmentText(segments, info.start);
  return {
    available: Boolean(picked.text),
    source: 'youtube',
    text: picked.text,
    start: picked.start,
    end: picked.end,
    ...(picked.text ? {} : { message: 'No transcript text was found for this segment.' }),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isBadRequestMessage(message: string) {
  return /choose the most appropriate reaction phrase|type or dictate your answer|user reply is required|required\./i.test(String(message || ''));
}

export async function registerRoutes(app: FastifyInstance) {
  const contentService = new ContentService(new FileSystemContentRepository(), new LocalMediaStore());
  const practiceService = new PracticeService(contentService);
  const speechService = new SpeechService();
  const backupService = new BackupService();
  const answeringStore = env.APP_ENV === 'production'
    ? new RedisSessionStore<AnsweringSession>()
    : new InMemorySessionStore<AnsweringSession>();
  const coachStore = env.APP_ENV === 'production'
    ? new RedisSessionStore<CoachChatSession>()
    : new InMemorySessionStore<CoachChatSession>();
  const answeringService = new AnsweringSessionService(answeringStore, contentService);
  const coachChatService = new CoachChatSessionService(coachStore, contentService);
  const debugLogs: DebugLogEntry[] = [];
  const videoTranscriptCache = new Map<string, VideoTranscriptResult>();

  function pushDebugLog(scope: string, event: string, details: Record<string, unknown> = {}) {
    const entry: DebugLogEntry = {
      id: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      scope,
      event,
      details,
    };

    debugLogs.push(entry);
    if (debugLogs.length > 300) {
      debugLogs.splice(0, debugLogs.length - 300);
    }

    app.log.info({ debug: entry }, `debug:${scope}:${event}`);
    return entry;
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    textProvider: env.LLM_TEXT_PROVIDER,
    sttProvider: env.LLM_STT_PROVIDER,
    ttsProvider: env.LLM_TTS_PROVIDER,
    appEnv: env.APP_ENV,
  }));

  app.get('/api/debug/logs', async () => ({ entries: debugLogs }));
  app.post('/api/debug/log', async (request) => {
    const body = request.body as { scope?: string; event?: string; details?: Record<string, unknown> };
    return {
      logged: true,
      entry: pushDebugLog(String(body.scope || 'client'), String(body.event || 'event'), asRecord(body.details)),
    };
  });

  app.get('/api/content', async () => contentService.getContent());
  app.get('/api/admin/content', async () => contentService.getContent());
  app.post('/api/admin/content', async (request) => {
    const body = request.body as { content?: unknown };
    return contentService.saveContent((body.content ?? request.body) as never);
  });
  app.post('/api/admin/media/upload', async (request) => {
    const body = request.body as { fileName: string; base64: string };
    return contentService.uploadMedia(body.fileName, body.base64);
  });
  app.post('/api/admin/media/delete', async (request) => {
    const body = request.body as { url: string };
    return contentService.deleteMedia(body.url);
  });

  app.get('/api/admin/backup/export', async (_request, reply) => {
    const backup = await backupService.createBackup();
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename=' + JSON.stringify(backup.fileName))
      .send(backup.bytes);
  });
  app.post('/api/admin/backup/import', async (request) => {
    const body = request.body as { fileName?: string; base64?: string };
    return backupService.restoreBackup(String(body.fileName || 'softskills-backup.zip'), String(body.base64 || ''));
  });

  app.get('/api/media/video-transcript', async (request, reply) => {
    const query = request.query as { url?: string };
    const url = String(query.url || '').trim();
    if (!url) {
      return reply.code(400).send({ available: false, source: 'unsupported', text: '', start: 0, end: 0, message: 'Video URL is required.' });
    }

    if (videoTranscriptCache.has(url)) {
      return videoTranscriptCache.get(url);
    }

    try {
      const result = await fetchYouTubeTranscript(url);
      videoTranscriptCache.set(url, result);
      if (videoTranscriptCache.size > 100) {
        const firstKey = videoTranscriptCache.keys().next().value;
        if (firstKey) {
          videoTranscriptCache.delete(firstKey);
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const info = getYouTubeVideoInfo(url);
      const result = unavailableYouTubeTranscript(info?.start || 0, message);
      videoTranscriptCache.set(url, result);
      return result;
    }
  });

  app.get('/uploads/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string })['*'] || '';
    const absolutePath = resolveLocalUploadPath(`/uploads/${wildcard}`);
    if (!absolutePath) {
      return reply.code(404).send({ error: 'File not found.' });
    }

    try {
      const contentType = getContentType(absolutePath);
      const stats = await stat(absolutePath);
      const range = parseRangeHeader(request.headers.range, stats.size);
      if (range) {
        const chunkSize = range.end - range.start + 1;
        return reply
          .code(206)
          .header('Accept-Ranges', 'bytes')
          .header('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`)
          .header('Content-Length', chunkSize)
          .type(contentType)
          .send(createReadStream(absolutePath, { start: range.start, end: range.end }));
      }

      return reply
        .header('Accept-Ranges', 'bytes')
        .header('Content-Length', stats.size)
        .type(contentType)
        .send(createReadStream(absolutePath));
    } catch {
      return reply.code(404).send({ error: 'File not found.' });
    }
  });

  app.post('/api/practice/clarify', async (request) => {
    const body = request.body as { context: string; offset?: number };
    return practiceService.generateClarify(body.context, body.offset);
  });
  app.post('/api/practice/clarify/check', async (request) => practiceService.checkClarify(request.body as never));
  app.post('/api/practice/after-talk', async (request) => {
    const body = request.body as { context: string; offset?: number };
    return practiceService.generateAskAfter(body.context, body.offset);
  });
  app.post('/api/practice/after-talk/check', async (request) => practiceService.checkAskAfter(request.body as never));
  app.post('/api/practice/question-formation', async (request) => {
    const body = request.body as { context?: string; offset?: number };
    return practiceService.generateQuestionFormation(body.context || '', body.offset);
  });
  app.post('/api/practice/question-formation/check', async (request) => practiceService.checkQuestionFormation(request.body as never));

  app.post('/api/answering/session/start', async (request) => {
    const body = request.body as { context: string; mode: 'good' | 'difficult' | 'unnecessary' | 'irrelevant' | 'mixed' };
    return answeringService.start(body.context, body.mode);
  });
  app.post('/api/answering/session/respond', async (request, reply) => {
    const body = request.body as { sessionId: string; reactionOptionId?: string; userReply: string; transcriptSource?: 'text' | 'speech' };
    if (!String(body.reactionOptionId || '').trim()) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Choose the most appropriate reaction phrase before you submit the answer.',
      });
    }

    try {
      return await answeringService.respond(body.sessionId, body.reactionOptionId, body.userReply, body.transcriptSource || 'text');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isBadRequestMessage(message)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message,
        });
      }

      throw error;
    }
  });

  app.post('/api/coach/session/start', async (request) => {
    const body = request.body as { context: string; goal: string; scenario?: string };
    return coachChatService.start(body.context, body.goal, body.scenario || '');
  });
  app.post('/api/coach/session/respond', async (request, reply) => {
    const body = request.body as { sessionId: string; userReply: string };
    try {
      return await coachChatService.respond(body.sessionId, body.userReply);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isBadRequestMessage(message)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message,
        });
      }

      throw error;
    }
  });

  app.post('/api/speech/stt', async (request) => {
    const body = request.body as { audioBase64?: string; mimeType?: string };
    pushDebugLog('speech', 'stt:start', {
      mimeType: String(body?.mimeType || ''),
      hasAudio: Boolean(body?.audioBase64),
      audioSize: String(body?.audioBase64 || '').length,
      provider: env.LLM_STT_PROVIDER,
      model: env.LLM_STT_MODEL,
    });

    try {
      const result = await speechService.speechToText(request.body as never);
      pushDebugLog('speech', 'stt:success', {
        provider: result.provider,
        model: result.model,
        textLength: String(result.text || '').length,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDebugLog('speech', 'stt:error', { message });
      throw error;
    }
  });

  app.post('/api/speech/tts', async (request) => {
    pushDebugLog('speech', 'tts:start', { provider: env.LLM_TTS_PROVIDER, model: env.LLM_TTS_MODEL });
    try {
      const result = await speechService.textToSpeech(request.body as never);
      pushDebugLog('speech', 'tts:success', { provider: result.provider, model: result.model });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDebugLog('speech', 'tts:error', { message });
      throw error;
    }
  });
}
