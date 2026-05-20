import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { AppContent, ContentBlock, ContentMaterial, ContentSection } from '@softskills/domain';
import { Screen } from '../../src/components/Screen';
import { AskAfterComposer } from '../../src/components/practice/AskAfterComposer';
import { ClarifyPracticeInlineList } from '../../src/components/practice/ClarifyPracticeInlineList';
import { QuestionFormationPractice } from '../../src/components/practice/QuestionFormationPractice';
import { useContent } from '../../src/hooks/useContent';
import { findSectionById, findSectionByRoute, getParentSection } from '../../src/lib/contentNavigation';
import {
  fillRuntimeTemplate,
  findPracticeScreenForSection,
  getBlockRenderer,
  getNestedString,
  getSectionViewConfig,
  getUiConfig,
} from '../../src/lib/contentMeta';
import { apiClient, resolveApiUrl } from '../../src/lib/api';
import { tokens } from '../../src/theme/tokens';

const directVideoPattern = /\.(mp4|webm|ogv|mov|m4v)(?:[?#].*)?$/i;
const directAudioPattern = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)(?:[?#].*)?$/i;
const directImagePattern = /\.(png|jpg|jpeg|gif|webp|svg)(?:[?#].*)?$/i;
const youTubeIdPattern = /^[A-Za-z0-9_-]{6,}$/;
const youTubeLegacyPattern = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
const vimeoPattern = /vimeo\.com\/(?:video\/)?(\d+)/i;

function getPracticeHref(content: AppContent | null | undefined, section: ContentSection, block: ContentBlock) {
  const renderer = getBlockRenderer(content, block.kind);
  const match = findPracticeScreenForSection(content, section, renderer);
  if (!match) {
    return undefined;
  }

  const templateValues = {
    ...match.params,
    sectionId: section.id,
    sectionRoute: section.route,
    sectionType: section.type,
    blockId: block.id,
    blockKind: block.kind,
  };

  const templateHref = getNestedString(match.config, ['targetHrefTemplate']);
  if (templateHref) {
    return fillRuntimeTemplate(templateHref, templateValues);
  }

  const directHref = getNestedString(match.config, ['targetHref']);
  return directHref ? fillRuntimeTemplate(directHref, templateValues) : undefined;
}

function getMaterialUrl(material: ContentMaterial) {
  return material.url ? resolveApiUrl(material.url) : '';
}

function isDirectAsset(url: string, pattern: RegExp) {
  return Boolean(url) && (url.startsWith('data:') || url.startsWith('blob:') || pattern.test(url));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function getBlockLayoutWidth(block: ContentBlock) {
  const value = asString(asRecord(block.meta).layoutWidth).toLowerCase();
  return ['full', 'half'].includes(value) ? value : 'auto';
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
    const end = parseSeconds(parsed.searchParams.get('end') || '');
    return { id, start, end };
  } catch {
    const match = url.match(youTubeLegacyPattern);
    return match?.[1] ? { id: match[1], start: 0, end: 0 } : null;
  }
}

function getEmbeddedYouTubeSegmentEnd(url: string) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('youtube.com')) {
      return 0;
    }
    return parseSeconds(parsed.searchParams.get('end') || '');
  } catch {
    return 0;
  }
}

function getEmbeddedVideoUrl(url: string) {
  if (!url) {
    return '';
  }

  const youTubeInfo = getYouTubeVideoInfo(url);
  if (youTubeInfo) {
    const params = new URLSearchParams();
    if (youTubeInfo.start > 0) {
      params.set('start', String(youTubeInfo.start));
    }
    if (youTubeInfo.end > youTubeInfo.start) {
      params.set('end', String(youTubeInfo.end));
    }
    params.set('enablejsapi', '1');
    if (typeof window !== 'undefined' && window.location?.origin) {
      params.set('origin', window.location.origin);
    }
    return `https://www.youtube.com/embed/${youTubeInfo.id}?${params.toString()}`;
  }

  const vimeoMatch = url.match(vimeoPattern);
  if (vimeoMatch) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  return '';
}

function useFocusedMediaActive() {
  const [active, setActive] = useState(true);

  useFocusEffect(useCallback(() => {
    setActive(true);
    return () => setActive(false);
  }, []));

  return active;
}

function getMaterialTranscript(material: ContentMaterial, mediaUrl: string, startTime = 0, endTime = 0) {
  const youTubeInfo = getYouTubeVideoInfo(mediaUrl);
  if (!youTubeInfo || !(endTime > startTime)) {
    return '';
  }

  const meta = asRecord(material.meta);
  const segments = Array.isArray(meta.transcriptSegments) ? meta.transcriptSegments : [];
  if (segments.length) {
    const filtered = segments.filter((item) => {
      const segment = asRecord(item);
      const from = typeof segment.start === 'number' ? segment.start : Number.parseInt(String(segment.start || '0'), 10);
      const to = typeof segment.end === 'number' ? segment.end : Number.parseInt(String(segment.end || '0'), 10);
      return Number.isFinite(from) && Number.isFinite(to) && from < endTime && to > startTime;
    });
    const text = filtered.map((item) => asString(asRecord(item).text)).filter(Boolean).join(' ').trim();
    if (text) {
      return text;
    }
  }

  const directTranscript = asString(meta.transcript) || asString(meta.videoTranscript) || asString(meta.caption);
  return directTranscript.trim();
}

function VideoTranscript({ mediaUrl, initialText, startTime = 0, endTime = 0 }: { mediaUrl: string; initialText: string; startTime?: number; endTime?: number }) {
  const [text, setText] = useState(initialText);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    setText(initialText);
    setStatus('');

    if (initialText || !getYouTubeVideoInfo(mediaUrl) || !(endTime > startTime)) {
      return () => {
        cancelled = true;
      };
    }

    apiClient.getVideoTranscript(mediaUrl)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setText(String(result.text || '').trim());
        setStatus(result.text ? '' : String(result.message || ''));
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setStatus(error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialText, mediaUrl, startTime, endTime]);

  if (!text && !status) {
    return null;
  }

  return (
    <View style={styles.transcriptBox}>
      <ScrollView nestedScrollEnabled>
        <Text style={styles.transcriptText}>{text || status}</Text>
      </ScrollView>
    </View>
  );
}

function openExternalUrl(url: string) {
  if (!url) {
    return;
  }

  void Linking.openURL(url);
}

function WebVideoPlayer({ url }: { url: string }) {
  const active = useFocusedMediaActive();
  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.webMediaShell}>
      {active ? (
        <video controls playsInline preload="metadata" src={url} style={webVideoStyle}>
          <source src={url} />
        </video>
      ) : null}
    </View>
  );
}

function WebAudioPlayer({ url }: { url: string }) {
  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.webAudioShell}>
      <audio controls preload="metadata" src={url} style={webAudioStyle} />
    </View>
  );
}

function WebVideoEmbed({ url }: { url: string }) {
  const active = useFocusedMediaActive();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const youtubeSegmentEnd = getEmbeddedYouTubeSegmentEnd(url);

  useEffect(() => {
    if (Platform.OS !== 'web' || !active || !youtubeSegmentEnd) {
      return undefined;
    }

    const playerId = `youtube-segment-${Math.random().toString(36).slice(2)}`;
    const postMessage = (func: string, args: unknown[] = []) => {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', id: playerId, func, args }), '*');
    };
    const subscribe = () => {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: playerId }), '*');
    };

    const onMessage = (event: MessageEvent) => {
      let payload: unknown = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }

      const data = asRecord(payload);
      if (data.event !== 'infoDelivery') {
        return;
      }

      const currentTime = Number(asRecord(data.info).currentTime);
      if (Number.isFinite(currentTime) && currentTime >= youtubeSegmentEnd) {
        postMessage('pauseVideo');
        postMessage('seekTo', [youtubeSegmentEnd, true]);
      }
    };

    subscribe();
    const intervalId = window.setInterval(() => {
      subscribe();
      postMessage('getCurrentTime');
    }, 500);
    window.addEventListener('message', onMessage);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('message', onMessage);
    };
  }, [active, url, youtubeSegmentEnd]);

  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.webMediaShell}>
      {active ? (
        <iframe
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          ref={iframeRef}
          src={url}
          style={webFrameStyle}
          title="embedded-video"
        />
      ) : null}
    </View>
  );
}

function MaterialOpenButton({ url, label }: { url: string; label: string }) {
  if (!url) {
    return null;
  }

  return (
    <Pressable style={styles.mediaButton} onPress={() => openExternalUrl(url)}>
      <Text style={styles.mediaButtonText}>{label}</Text>
    </Pressable>
  );
}

function renderMaterial(material: ContentMaterial, options: { emptyMediaText: string; inlineMediaUnavailable: string; openMediaLabel: string }) {
  const placeholderCopy = material.body || options.emptyMediaText;
  const mediaUrl = getMaterialUrl(material);
  const videoInfo = material.type === 'video' ? getYouTubeVideoInfo(mediaUrl) : null;
  const startTime = videoInfo?.start ?? 0;
  const endTime = videoInfo?.end ?? 0;
  const embeddedVideoUrl = material.type === 'video' ? getEmbeddedVideoUrl(mediaUrl) : '';
  const isDirectVideo = material.type === 'video' && isDirectAsset(mediaUrl, directVideoPattern);
  const isDirectAudio = material.type === 'audio' && isDirectAsset(mediaUrl, directAudioPattern);
  const isDirectImage = material.type === 'image' && isDirectAsset(mediaUrl, directImagePattern);
  const transcript = videoInfo ? getMaterialTranscript(material, mediaUrl, startTime, endTime) : '';

  if (material.type === 'text') {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <Text style={styles.materialBody}>{material.body}</Text>
      </View>
    );
  }

  if (isDirectImage) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <Image source={{ uri: mediaUrl }} style={styles.imagePreview} resizeMode="cover" />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} />
      </View>
    );
  }

  if (isDirectVideo) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <WebVideoPlayer url={mediaUrl} />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        {Platform.OS !== 'web' ? <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} /> : null}
      </View>
    );
  }

  if (embeddedVideoUrl) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <WebVideoEmbed url={embeddedVideoUrl} />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        {videoInfo ? <VideoTranscript mediaUrl={mediaUrl} initialText={transcript} startTime={startTime} endTime={endTime} /> : null}
        {Platform.OS !== 'web' ? <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} /> : null}
      </View>
    );
  }

  if (isDirectAudio) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <WebAudioPlayer url={mediaUrl} />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} />
      </View>
    );
  }

  return (
    <View key={material.id} style={[styles.materialCard, styles.placeholderCard]}>
      <Text style={styles.materialLabel}>{material.title}</Text>
      <Text style={styles.materialBody}>{placeholderCopy}</Text>
      {mediaUrl ? <Text style={styles.inlineNotice}>{options.inlineMediaUnavailable}</Text> : null}
      <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} />
    </View>
  );
}

function BlockAccordion({
  block,
  open,
  onToggle,
  onOpenPractice,
  practiceButtonLabel,
  emptyMediaText,
  inlineMediaUnavailable,
  openMediaLabel,
}: {
  block: ContentBlock;
  open: boolean;
  onToggle: () => void;
  onOpenPractice?: () => void;
  practiceButtonLabel: string;
  emptyMediaText: string;
  inlineMediaUnavailable: string;
  openMediaLabel: string;
}) {
  return (
    <View style={[styles.blockCard, open ? styles.blockCardOpen : null]}>
      <Pressable style={styles.blockToggle} onPress={onToggle}>
        <View style={styles.blockHeaderCopy}>
          <Text style={styles.blockTitle}>{block.title}</Text>
          <Text style={styles.blockDescription}>{block.description}</Text>
        </View>
        <View style={[styles.toggleBadge, open ? styles.toggleBadgeOpen : null]}>
          <Text style={styles.toggleGlyph}>{open ? '-' : '+'}</Text>
        </View>
      </Pressable>

      {open ? (
        <View style={styles.blockBody}>
          {(block.materials ?? []).map((material) => renderMaterial(material, { emptyMediaText, inlineMediaUnavailable, openMediaLabel }))}
          {onOpenPractice ? (
            <Pressable style={styles.practiceButton} onPress={onOpenPractice}>
              <Text style={styles.practiceButtonText}>{practiceButtonLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function BlockPanel({
  block,
  onOpenPractice,
  practiceButtonLabel,
  emptyMediaText,
  inlineMediaUnavailable,
  openMediaLabel,
}: {
  block: ContentBlock;
  onOpenPractice?: () => void;
  practiceButtonLabel: string;
  emptyMediaText: string;
  inlineMediaUnavailable: string;
  openMediaLabel: string;
}) {
  return (
    <View style={styles.blockCard}>
      <Text style={styles.blockTitle}>{block.title}</Text>
      <Text style={styles.blockDescription}>{block.description}</Text>
      <View style={styles.blockBody}>
        {(block.materials ?? []).map((material) => renderMaterial(material, { emptyMediaText, inlineMediaUnavailable, openMediaLabel }))}
        {onOpenPractice ? (
          <Pressable style={styles.practiceButton} onPress={onOpenPractice}>
            <Text style={styles.practiceButtonText}>{practiceButtonLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function LearnerSectionScreen({ sectionId, sectionRoute }: { sectionId?: string; sectionRoute?: string }) {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { content, loading, error } = useContent();
  const { width } = useWindowDimensions();
  const resolvedSectionId = sectionId ?? id;
  const section = sectionRoute ? findSectionByRoute(content, sectionRoute) : findSectionById(content, resolvedSectionId);
  const parentSection = getParentSection(content, section);
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({});
  const isWide = width >= 920;
  const sectionView = getSectionViewConfig(content, section?.type);
  const collapsibleSection = Boolean(section && sectionView.collapsible);
  const ui = getUiConfig(content);
  const loadingTitle = getNestedString(ui, ['feedback', 'loadingSectionTitle']);
  const loadingSubtitle = getNestedString(ui, ['feedback', 'loadingSectionSubtitle']);
  const missingTitle = getNestedString(ui, ['feedback', 'sectionNotFoundTitle']);
  const missingSubtitle = getNestedString(ui, ['feedback', 'sectionNotFoundSubtitle']);
  const loadErrorTitle = getNestedString(ui, ['feedback', 'unableToLoadContentTitle']);
  const noFileUploaded = getNestedString(ui, ['feedback', 'noFileUploaded']);
  const inlineMediaUnavailable = getNestedString(ui, ['feedback', 'inlineMediaUnavailable']);
  const openLivePractice = getNestedString(ui, ['buttons', 'openLivePractice']);
  const openMedia = getNestedString(ui, ['buttons', 'openMedia']);
  const backToHome = getNestedString(ui, ['navigation', 'backToHome']);

  useEffect(() => {
    if (!section) {
      return;
    }

    const nextState: Record<string, boolean> = {};
    for (const block of section.blocks) {
      nextState[block.id] = false;
    }
    setOpenBlocks(nextState);
  }, [section?.id]);

  if (!section) {
    return (
      <Screen
        appTitle={content?.meta.appTitle}
        brandTagline={getNestedString(ui, ['brandTagline'])}
        footerNote={getNestedString(ui, ['footerNote'])}
        watermarkText={getNestedString(ui, ['watermarkText'])}
        title={loading ? loadingTitle : missingTitle}
        subtitle={loading ? loadingSubtitle : missingSubtitle}
        backHref="/"
        backLabel={backToHome}
      >
        {loading ? <ActivityIndicator color={tokens.colors.accentContrast} /> : null}
        {error ? (
          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackTitle}>{loadErrorTitle}</Text>
            <Text style={styles.feedbackText}>{error}</Text>
          </View>
        ) : null}
      </Screen>
    );
  }

  const routeBlocks = section.blocks.filter((block) => getBlockRenderer(content, block.kind) === 'nav-card' && block.route);
  const contentBlocks = section.blocks.filter((block) => !(getBlockRenderer(content, block.kind) === 'nav-card' && block.route));
  const showInlineAskAfterComposer = section.type === 'practice-ask-after' || section.type === 'exercise-ask-after';
  const askAfterPracticeBlock = showInlineAskAfterComposer
    ? (section.blocks.find((block) => getBlockRenderer(content, block.kind) === 'practice-ask-after') || null)
    : null;
  const primaryRouteCount = sectionView.primaryCardStrategy === 'first' ? 1 : 0;
  const featuredBlockCount = isWide ? sectionView.featuredBlockCount : 0;

  return (
    <Screen
      appTitle={content?.meta.appTitle}
      brandTagline={getNestedString(ui, ['brandTagline'])}
      footerNote={getNestedString(ui, ['footerNote'])}
      watermarkText={getNestedString(ui, ['watermarkText'])}
      eyebrow={section.eyebrow}
      title={section.title}
      subtitle={section.summary}
      backHref={parentSection ? parentSection.route as Href : '/'}
      backLabel={parentSection ? parentSection.title : backToHome}
    >
      {loading && !content ? <ActivityIndicator color={tokens.colors.accentContrast} /> : null}
      {error ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackTitle}>{loadErrorTitle}</Text>
          <Text style={styles.feedbackText}>{error}</Text>
        </View>
      ) : null}

      {routeBlocks.length ? (
        <View style={styles.routeGrid}>
          {routeBlocks.map((block, index) => {
            const targetSection = findSectionByRoute(content, block.route);
            if (!targetSection) {
              return null;
            }

            return (
              <Pressable
                key={block.id}
                style={[styles.routeCard, index < primaryRouteCount ? styles.routeCardPrimary : null]}
                onPress={() => router.push(targetSection.route as Href)}
              >
                <Text style={styles.routeCardTitle}>{block.title}</Text>
                <Text style={styles.routeCardText}>{block.description}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showInlineAskAfterComposer && askAfterPracticeBlock ? (
        <AskAfterComposer content={content} section={section} practiceBlock={askAfterPracticeBlock} />
      ) : contentBlocks.length ? (
        <View style={styles.blockGrid}>
          {contentBlocks.map((block, index) => {
            const practiceHref = getPracticeHref(content, section, block);
            const renderer = getBlockRenderer(content, block.kind);
            const blockLayoutWidth = getBlockLayoutWidth(block);
            const isHalfWidthCard = (blockLayoutWidth === 'half' && isWide)
              || (blockLayoutWidth === 'auto' && renderer !== 'practice-clarify' && renderer !== 'practice-without-context' && featuredBlockCount > 0 && index < featuredBlockCount);

            return (
              <View
                key={block.id}
                style={[
                  styles.blockSlot,
                  isHalfWidthCard ? styles.blockSlotHalf : styles.blockSlotFull,
                ]}
              >
                {renderer === 'practice-clarify' ? (
                  <ClarifyPracticeInlineList content={content} section={section} block={block} />
                ) : renderer === 'practice-without-context' ? (
                  <QuestionFormationPractice content={content} section={section} block={block} />
                ) : collapsibleSection ? (
                  <BlockAccordion
                    block={block}
                    open={Boolean(openBlocks[block.id])}
                    onToggle={() => setOpenBlocks((current) => ({
                      ...current,
                      [block.id]: !current[block.id],
                    }))}
                    onOpenPractice={practiceHref ? () => router.push(practiceHref as Href) : undefined}
                    practiceButtonLabel={openLivePractice}
                    emptyMediaText={noFileUploaded}
                    inlineMediaUnavailable={inlineMediaUnavailable}
                    openMediaLabel={openMedia}
                  />
                ) : (
                  <BlockPanel
                    block={block}
                    onOpenPractice={practiceHref ? () => router.push(practiceHref as Href) : undefined}
                    practiceButtonLabel={openLivePractice}
                    emptyMediaText={noFileUploaded}
                    inlineMediaUnavailable={inlineMediaUnavailable}
                    openMediaLabel={openMedia}
                  />
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

export default function SectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LearnerSectionScreen sectionId={id} />;
}

const webFrameStyle = {
  width: '100%',
  height: '100%',
  border: 0,
  backgroundColor: '#000',
};

const webVideoStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'contain' as const,
  backgroundColor: '#000',
};

const webAudioStyle = {
  width: '100%',
};

const styles = StyleSheet.create({
  routeGrid: {
    gap: tokens.spacing.md,
  },
  routeCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    minHeight: 110,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  routeCardPrimary: {
    backgroundColor: tokens.colors.surface,
  },
  routeCardTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  routeCardText: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  blockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.md,
  },
  blockSlot: {
    minWidth: 0,
  },
  blockSlotHalf: {
    width: '48.8%',
  },
  blockSlotFull: {
    width: '100%',
  },
  blockCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  blockCardOpen: {
    backgroundColor: tokens.colors.surfaceMuted,
  },
  blockToggle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacing.md,
  },
  blockHeaderCopy: {
    flex: 1,
  },
  blockTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  blockDescription: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  toggleBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.colors.surface,
  },
  toggleBadgeOpen: {
    backgroundColor: tokens.colors.accentSoft,
  },
  toggleGlyph: {
    color: tokens.colors.accentDeep,
    fontSize: 18,
    fontWeight: '900',
  },
  blockBody: {
    marginTop: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  materialCard: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  placeholderCard: {
    backgroundColor: tokens.colors.surfaceMuted,
  },
  materialLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  materialBody: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  inlineNotice: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
    fontSize: 13,
  },
  imagePreview: {
    width: '100%',
    height: 240,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  webMediaShell: {
    width: '100%',
    aspectRatio: 16 / 9,
    maxHeight: 520,
    borderRadius: tokens.radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  transcriptBox: {
    maxHeight: 220,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  transcriptText: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  webAudioShell: {
    width: '100%',
  },
  mediaButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    justifyContent: 'center',
  },
  mediaButtonText: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  practiceButton: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
  },
  practiceButtonText: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  feedbackCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  feedbackTitle: {
    color: tokens.colors.danger,
    fontWeight: '800',
    fontSize: 16,
  },
  feedbackText: {
    marginTop: tokens.spacing.xs,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
});
