import type { FastifyInstance } from 'fastify';

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

const youTubeIdPattern = /^[A-Za-z0-9_-]{6,}$/;
const youTubeLegacyPattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
const transcriptLanguages = ['ru', 'ru-RU', 'en', 'en-US', 'en-GB'];

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

async function fetchTimedTextTranscript(videoId: string) {
  for (const language of transcriptLanguages) {
    const transcriptUrl = new URL('https://www.youtube.com/api/timedtext');
    transcriptUrl.searchParams.set('v', videoId);
    transcriptUrl.searchParams.set('lang', language);
    transcriptUrl.searchParams.set('fmt', 'json3');

    const response = await fetch(transcriptUrl);
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

  const preferred = tracks.find((track) => String(track.languageCode || '').toLowerCase().startsWith('ru'))
    || tracks.find((track) => String(track.languageCode || '').toLowerCase().startsWith('en'))
    || tracks.find((track) => String(track.kind || '').toLowerCase() === 'asr')
    || tracks[0];

  return typeof preferred?.baseUrl === 'string' ? preferred.baseUrl : '';
}

async function fetchInnertubePlayerResponse(videoId: string) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 CLEARn transcript fetcher',
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

  if (!response.ok) return null;
  return response.json() as Promise<Record<string, unknown>>;
}

async function fetchTranscriptTrack(trackUrl: string) {
  const transcriptUrl = new URL(decodeHtmlEntities(trackUrl));
  transcriptUrl.searchParams.set('fmt', 'json3');

  const response = await fetch(transcriptUrl);
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
  const timedTextSegments = await fetchTimedTextTranscript(videoId);
  if (timedTextSegments.length) return timedTextSegments;

  const innertubeResponse = await fetchInnertubePlayerResponse(videoId);
  const baseUrl = innertubeResponse ? getCaptionTrackBaseUrl(innertubeResponse) : '';
  return baseUrl ? fetchTranscriptTrack(baseUrl) : [];
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

export async function registerVideoTranscriptSegmentRoutes(app: FastifyInstance) {
  const cache = new Map<string, { available: boolean; source: 'youtube' | 'unsupported'; text: string; start: number; end: number; message?: string }>();

  app.get('/api/media/youtube-transcript-segment', async (request, reply) => {
    const query = request.query as { url?: string };
    const url = String(query.url || '').trim();
    if (!url) {
      return reply.code(400).send({ available: false, source: 'unsupported', text: '', start: 0, end: 0, message: 'Video URL is required.' });
    }

    if (cache.has(url)) {
      return cache.get(url);
    }

    const info = getYouTubeVideoInfo(url);
    if (!info) {
      return { available: false, source: 'unsupported', text: '', start: 0, end: 0, message: 'Unsupported video source.' };
    }

    try {
      const segments = await fetchTranscriptSegments(info.id);
      const picked = pickTranscriptSegmentText(segments, info.start, info.end);
      const result = {
        available: Boolean(picked.text),
        source: 'youtube' as const,
        text: picked.text,
        start: picked.start,
        end: picked.end,
        ...(picked.text ? {} : { message: 'Transcript for the selected YouTube segment was not found.' }),
      };

      cache.set(url, result);
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
