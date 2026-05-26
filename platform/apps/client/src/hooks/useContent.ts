import { useEffect, useState } from 'react';
import type { AppContent, ContentMaterial } from '@clearn/domain';
import { apiClient } from '../lib/api';

function parseSeconds(value: unknown) {
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

function isYouTubeUrl(url: string) {
  return /(?:youtu\.be\/|youtube\.com\/(?:watch|embed|shorts|live))/i.test(url);
}

function isDirectVideoUrl(url: string) {
  return /(?:^\/uploads\/|\/uploads\/|\.(?:mp4|webm|ogv|mov|m4v)(?:[?#].*)?$)/i.test(url);
}

function getMetaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstMetaNumber(meta: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const parsed = parseSeconds(meta[key]);
    if (parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function getUrlNumber(url: string, key: string) {
  try {
    return parseSeconds(new URL(url).searchParams.get(key));
  } catch {
    return 0;
  }
}

function getSegmentBounds(material: ContentMaterial) {
  const url = String(material.url || '');
  const meta = getMetaRecord(material.meta);
  let start = isYouTubeUrl(url) ? (getUrlNumber(url, 'start') || getUrlNumber(url, 't')) : 0;
  let end = isYouTubeUrl(url) ? getUrlNumber(url, 'end') : 0;

  if (!start) {
    start = firstMetaNumber(meta, ['segmentStart', 'start', 'clipStart']);
  }
  if (!end) {
    end = firstMetaNumber(meta, ['segmentEnd', 'end', 'clipEnd']);
  }

  const fragment = url.match(/#t=([^,]+),([^&]+)$/);
  if (fragment) {
    start = parseSeconds(fragment[1]);
    end = parseSeconds(fragment[2]);
  }

  return { start, end };
}

function withYouTubeSegment(url: string, start: number, end: number) {
  try {
    const parsed = new URL(url);
    if (start > 0 && !parsed.searchParams.get('start') && !parsed.searchParams.get('t')) {
      parsed.searchParams.set('start', String(start));
    }
    if (end > start && !parsed.searchParams.get('end')) {
      parsed.searchParams.set('end', String(end));
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function withDirectVideoSegment(url: string, start: number, end: number) {
  if (!(end > start) || /#t=/.test(url)) {
    return url;
  }
  return `${url}#t=${start},${end}`;
}

function buildTranscriptFromSegments(meta: Record<string, unknown>, start: number, end: number) {
  if (typeof meta.transcript === 'string' && meta.transcript.trim()) {
    return meta.transcript.trim();
  }
  const segments = Array.isArray(meta.transcriptSegments) ? meta.transcriptSegments : [];
  if (!segments.length) {
    return '';
  }

  return segments
    .filter((item) => {
      const segment = getMetaRecord(item);
      const from = typeof segment.start === 'number' ? segment.start : parseSeconds(segment.start);
      const to = typeof segment.end === 'number' ? segment.end : parseSeconds(segment.end);
      return Number.isFinite(from) && Number.isFinite(to) && from < (end || Infinity) && to > start;
    })
    .map((item) => String(getMetaRecord(item).text || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function normalizeVideoMaterial(material: ContentMaterial): ContentMaterial {
  if (material.type !== 'video' || !material.url) {
    return material;
  }

  const originalUrl = String(material.url);
  const meta = getMetaRecord(material.meta);
  const { start, end } = getSegmentBounds(material);
  const nextUrl = isYouTubeUrl(originalUrl)
    ? withYouTubeSegment(originalUrl, start, end)
    : isDirectVideoUrl(originalUrl)
      ? withDirectVideoSegment(originalUrl, start, end)
      : originalUrl;
  const transcript = buildTranscriptFromSegments(meta, start, end);

  if (nextUrl === originalUrl && !transcript) {
    return material;
  }

  return {
    ...material,
    url: nextUrl,
    meta: {
      ...meta,
      ...(start > 0 ? { segmentStart: String(start) } : {}),
      ...(end > start ? { segmentEnd: String(end) } : {}),
      ...(transcript ? { transcript } : {}),
    },
  };
}

function normalizeSegmentedVideos(content: AppContent): AppContent {
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        materials: (block.materials || []).map(normalizeVideoMaterial),
      })),
    })),
  };
}

export function useContent() {
  const [content, setContent] = useState<AppContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiClient.logDebug('content', 'load:start');
    apiClient.getContent()
      .then((nextContent) => {
        const normalizedContent = normalizeSegmentedVideos(nextContent);
        setContent(normalizedContent);
        void apiClient.logDebug('content', 'load:success', {
          sectionCount: normalizedContent.sections.length,
          updatedAt: normalizedContent.meta.updatedAt,
        });
      })
      .catch((nextError: Error) => {
        setError(nextError.message);
        void apiClient.logDebug('content', 'load:error', { message: nextError.message });
      })
      .finally(() => setLoading(false));
  }, []);

  return { content, loading, error };
}
