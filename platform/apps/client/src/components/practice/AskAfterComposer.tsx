import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppContent, AskAfterBrief, AskAfterSpeechLine, ContentBlock, ContentSection } from '@softskills/domain';
import { useSpeechDraft } from '../../hooks/useSpeechDraft';
import { apiClient, resolveApiUrl } from '../../lib/api';
import {
  findFirstBlockByRenderer,
  getBlockGroupConfig,
  getBlocksByRenderer,
  getMaterialBodies,
  getNestedString,
  getPracticeScreenConfig,
  getUiConfig,
} from '../../lib/contentMeta';
import { tokens } from '../../theme/tokens';

type PhraseSlot = 'context' | 'follow';
type SourceMode = 'generated' | 'video';

type PhraseDragPayload = {
  slot: PhraseSlot;
  value: string;
};

type AskAfterComposerProps = {
  content: AppContent | null | undefined;
  section?: ContentSection | null;
  practiceBlock?: ContentBlock | null;
};

const directVideoPattern = /\.(mp4|webm|ogv|mov|m4v)(?:[?#].*)?$/i;
const youTubeIdPattern = /^[A-Za-z0-9_-]{6,}$/;
const vimeoPattern = /vimeo\.com\/(?:video\/)?(\d+)/i;

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function capitalizeSentence(value: string) {
  const next = normalizeText(value);
  if (!next) {
    return '';
  }

  return next.charAt(0).toUpperCase() + next.slice(1);
}

function stripPlaceholder(value: string) {
  return normalizeText(String(value || '').replace(/\.\.\./g, '').replace(/\s+([,?.!])/g, '$1'));
}

function buildContextSegment(opener: string, detail: string) {
  const cleanDetail = normalizeText(detail);
  let next = normalizeText(opener);

  if (!next && !cleanDetail) {
    return '';
  }

  if (next.includes('...')) {
    next = normalizeText(next.replace(/\.\.\./g, cleanDetail || 'that'));
  } else if (cleanDetail) {
    next = normalizeText(`${next} ${cleanDetail}`);
  }

  next = next.replace(/\s+([,?.!])/g, '$1').replace(/[?]+$/g, '').trim();
  if (!next) {
    return '';
  }

  if (!/[.!]$/.test(next)) {
    next = `${next}.`;
  }

  return capitalizeSentence(next);
}

function buildFollowSegment(followUp: string) {
  let next = normalizeText(followUp);
  if (!next) {
    return '';
  }

  next = next.replace(/\.\.\./g, 'that').replace(/\s+([,?.!])/g, '$1').trim();
  if (!/^(could|can|would|what|when|why|who|which|how|is|are|do|does|did|will|have|has|should)\b/i.test(next)) {
    next = `Could you ${next}`;
  }

  next = capitalizeSentence(next).replace(/[.]+$/g, '').trim();
  if (!/[?]$/.test(next)) {
    next = `${next}?`;
  }

  return next;
}

function buildQuestion(opener: string, followUp: string, detail: string) {
  return [buildContextSegment(opener, detail), buildFollowSegment(followUp)].filter(Boolean).join(' ').trim();
}

function getPhraseDisplayText(value: string, slot: PhraseSlot) {
  if (!value) {
    return '';
  }

  return slot === 'follow' ? buildFollowSegment(value) : stripPlaceholder(value);
}

function getSpeechLineText(line: AskAfterSpeechLine) {
  if (typeof line === 'string') {
    return line;
  }

  const text = typeof line?.text === 'string' ? line.text.trim() : '';
  return text || '';
}

function getSpeechLineKey(line: AskAfterSpeechLine, index: number) {
  if (typeof line === 'string') {
    return `${index}-${line}`;
  }

  const speaker = typeof line?.speaker === 'string' ? line.speaker : '';
  const text = typeof line?.text === 'string' ? line.text : '';
  return `${index}-${speaker}-${text}`;
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

    return {
      id,
      start: parseSeconds(parsed.searchParams.get('start') || parsed.searchParams.get('t') || ''),
      end: parseSeconds(parsed.searchParams.get('end') || ''),
    };
  } catch {
    return null;
  }
}

function getEmbeddedVideoUrl(url: string) {
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
    return `https://www.youtube.com/embed/${youTubeInfo.id}?${params.toString()}`;
  }

  const vimeoMatch = url.match(vimeoPattern);
  if (vimeoMatch) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  return '';
}

function getVideoThumbnailUrl(url: string, fallback = '') {
  const youTubeInfo = getYouTubeVideoInfo(url);
  if (youTubeInfo) {
    return `https://img.youtube.com/vi/${youTubeInfo.id}/mqdefault.jpg`;
  }

  return fallback;
}

function getMaterialUrl(material: { url?: string }) {
  return material.url ? resolveApiUrl(material.url) : '';
}

function getMaterialTranscript(material: { body?: string; meta?: Record<string, unknown> }) {
  const meta = asRecord(material.meta);
  const directTranscript = asString(meta.transcript) || asString(meta.videoTranscript) || asString(meta.caption);
  if (directTranscript.trim()) {
    return directTranscript.trim();
  }

  return '';
}

function isVideoMaterial(material: { type?: string; url?: string }) {
  return material.type === 'video' && Boolean(material.url);
}

function useFocusedMediaActive() {
  const [active, setActive] = useState(true);

  useFocusEffect(useCallback(() => {
    setActive(true);
    return () => setActive(false);
  }, []));

  return active;
}

function parsePhrasePayload(raw: string): PhraseDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PhraseDragPayload>;
    if ((parsed.slot === 'context' || parsed.slot === 'follow') && typeof parsed.value === 'string') {
      return { slot: parsed.slot, value: parsed.value };
    }
  } catch {
  }

  return null;
}

function createPhraseDragProps(slot: PhraseSlot, value: string) {
  if (Platform.OS !== 'web' || !value) {
    return {};
  }

  return {
    draggable: true,
    onDragStart: (event: any) => {
      event?.dataTransfer?.setData('text/plain', JSON.stringify({ slot, value }));
      event?.dataTransfer?.setData('application/json', JSON.stringify({ slot, value }));
      if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    },
  };
}

function createPhraseDropProps(targetSlot: PhraseSlot, onDropPhrase: (payload: PhraseDragPayload) => void) {
  if (Platform.OS !== 'web') {
    return {};
  }

  return {
    onDragOver: (event: any) => {
      event.preventDefault();
      if (event?.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    },
    onDrop: (event: any) => {
      event.preventDefault();
      const raw = String(event?.dataTransfer?.getData('application/json') || event?.dataTransfer?.getData('text/plain') || '');
      const payload = parsePhrasePayload(raw);
      if (!payload || payload.slot !== targetSlot) {
        return;
      }

      onDropPhrase(payload);
    },
  };
}

export function AskAfterComposer({ content, section, practiceBlock }: AskAfterComposerProps) {
  const mediaActive = useFocusedMediaActive();
  const ui = getUiConfig(content);
  const practiceConfig = getPracticeScreenConfig(content, 'askAfter');
  const blockGroup = getBlockGroupConfig(content, 'askAfter');
  const practiceRenderer = getNestedString(practiceConfig, ['blockRenderer']);
  const resolvedPracticeBlock = practiceBlock || findFirstBlockByRenderer(content, section || undefined, practiceRenderer);
  const practiceBlocks = getBlocksByRenderer(content, section || undefined, practiceRenderer);

  const contextRenderer = getNestedString(blockGroup, ['contextRenderer'], 'generic');
  const followUpRenderer = getNestedString(blockGroup, ['followUpRenderer'], 'generic');
  const contextIndex = asNumber(blockGroup.contextIndex, 0);
  const followUpIndex = asNumber(blockGroup.followUpIndex, 1);
  const contextBlocks = getBlocksByRenderer(content, section || undefined, contextRenderer);
  const followUpBlocks = getBlocksByRenderer(content, section || undefined, followUpRenderer);
  const contextBlock = contextBlocks[contextIndex] as ContentBlock | undefined;
  const followUpBlock = followUpBlocks[followUpIndex] as ContentBlock | undefined;
  const contextPhrases = getMaterialBodies(contextBlock);
  const followUpPhrases = getMaterialBodies(followUpBlock);
  const videoMaterials = practiceBlocks.flatMap((block) => block.materials || []).filter(isVideoMaterial);
  const videoMaterialKey = videoMaterials.map((material) => `${material.id}:${material.url || ''}`).join('|');

  const [context, setContext] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('generated');
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [videoTranscript, setVideoTranscript] = useState('');
  const [videoTranscriptStatus, setVideoTranscriptStatus] = useState('');
  const [selectedContextPhrase, setSelectedContextPhrase] = useState('');
  const [selectedFollowPhrase, setSelectedFollowPhrase] = useState('');
  const [tail, setTail] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [brief, setBrief] = useState<AskAfterBrief | null>(null);
  const [feedback, setFeedback] = useState<{ accepted: boolean; feedback: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [offset, setOffset] = useState(0);
  const generatedQuestionRef = useRef('');

  useEffect(() => {
    if (!contextPhrases.length) {
      return;
    }

    if (!selectedContextPhrase || !contextPhrases.includes(selectedContextPhrase)) {
      setSelectedContextPhrase(contextPhrases[0] || '');
    }
  }, [contextPhrases, selectedContextPhrase]);

  useEffect(() => {
    if (!followUpPhrases.length) {
      return;
    }

    if (!selectedFollowPhrase || !followUpPhrases.includes(selectedFollowPhrase)) {
      setSelectedFollowPhrase(followUpPhrases[0] || '');
    }
  }, [followUpPhrases, selectedFollowPhrase]);

  useEffect(() => {
    if (!videoMaterials.length) {
      setSelectedVideoId('');
      if (sourceMode === 'video') {
        setSourceMode('generated');
      }
      return;
    }

    if (!selectedVideoId || !videoMaterials.some((material) => material.id === selectedVideoId)) {
      setSelectedVideoId(videoMaterials[0]?.id || '');
    }
  }, [selectedVideoId, sourceMode, videoMaterialKey]);

  const askAfterEmpty = getNestedString(ui, ['feedback', 'askAfterEmpty']);
  const generatedTalkTitle = getNestedString(ui, ['feedback', 'generatedTalkTitle']);
  const generatedTalkEyebrow = getNestedString(ui, ['feedback', 'generatedTalkEyebrow']);
  const questionBuilderTitle = getNestedString(ui, ['feedback', 'questionBuilderTitle']);
  const questionPreviewLabel = getNestedString(ui, ['feedback', 'questionPreviewLabel']);
  const dragPhraseHint = getNestedString(ui, ['feedback', 'askAfterDragPhraseHint'], 'Drag a phrase into the builder or tap it to place it.');
  const yourWorkContext = getNestedString(ui, ['labels', 'yourWorkContext']);
  const contextLeadIn = getNestedString(ui, ['labels', 'contextLeadIn']);
  const followUpRequest = getNestedString(ui, ['labels', 'followUpRequest']);
  const topicToFocusOn = getNestedString(ui, ['labels', 'topicToFocusOn']);
  const coachingTip = getNestedString(ui, ['labels', 'coachingTip']);
  const generateShortTalk = getNestedString(ui, ['buttons', 'generateShortTalk']);
  const reviewQuestion = getNestedString(ui, ['buttons', 'reviewQuestion']);
  const generateAnotherTalk = getNestedString(ui, ['buttons', 'generateAnotherTalk']);
  const startRecordingLabel = getNestedString(ui, ['buttons', 'startRecording']);
  const stopRecordingLabel = getNestedString(ui, ['buttons', 'stopRecording']);
  const recordingUnavailableText = getNestedString(ui, ['feedback', 'speechRecordingUnavailable']);
  const transcribingText = getNestedString(ui, ['feedback', 'speechTranscribing']);
  const emptyTranscriptText = getNestedString(ui, ['feedback', 'speechTranscriptEmpty']);
  const askAfterContext = getNestedString(ui, ['placeholders', 'askAfterContext']);
  const askAfterTail = getNestedString(ui, ['placeholders', 'askAfterTail']);
  const videoPracticeLibraryLabel = getNestedString(ui, ['labels', 'videoPracticeLibrary'], 'Video practice library');
  const videoPracticeLibraryDescription = getNestedString(ui, ['feedback', 'videoPracticeLibraryDescription'], 'Use uploaded videos or streaming links as the talk source. The question builder below stays the same.');
  const generatedTalkSourceLabel = getNestedString(ui, ['buttons', 'generatedTalkSource'], 'Generated talk');
  const videoTranscriptSourceLabel = getNestedString(ui, ['buttons', 'videoTranscriptSource'], 'Video transcript');
  const videoSourceLabel = getNestedString(ui, ['labels', 'videoSource'], 'Video source');
  const videoLibraryLabel = getNestedString(ui, ['labels', 'videoLibrary'], 'Video library');
  const videoLibraryHint = getNestedString(ui, ['feedback', 'videoLibraryHint'], 'Choose a video, then build a follow-up question from its transcript.');
  const openVideoLabel = getNestedString(ui, ['buttons', 'openVideo'], 'Open video');
  const selectedVideo = videoMaterials.find((material) => material.id === selectedVideoId) || videoMaterials[0];
  const selectedVideoUrl = selectedVideo ? getMaterialUrl(selectedVideo) : '';
  const selectedVideoManualTranscript = selectedVideo ? getMaterialTranscript(selectedVideo) : '';

  useEffect(() => {
    let cancelled = false;
    setVideoTranscript(selectedVideoManualTranscript);
    setVideoTranscriptStatus('');

    if (!selectedVideo || selectedVideoManualTranscript || !getYouTubeVideoInfo(selectedVideoUrl)) {
      return () => {
        cancelled = true;
      };
    }

    apiClient.getVideoTranscript(selectedVideoUrl)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setVideoTranscript(String(result.text || '').trim());
        setVideoTranscriptStatus(result.text ? '' : String(result.message || ''));
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setVideoTranscriptStatus(error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedVideo?.id, selectedVideoManualTranscript, selectedVideoUrl]);

  const builtQuestion = buildQuestion(selectedContextPhrase, selectedFollowPhrase, tail);

  useEffect(() => {
    setQuestionDraft((current) => {
      const previousGenerated = generatedQuestionRef.current;
      generatedQuestionRef.current = builtQuestion;
      if (!current.trim() || current === previousGenerated) {
        return builtQuestion;
      }
      return current;
    });
  }, [builtQuestion]);

  const {
    recording,
    transcribing,
    speechStatus,
    startRecording,
    stopRecording,
    clearSpeechStatus,
  } = useSpeechDraft({
    scope: 'ask-after',
    unsupportedMessage: recordingUnavailableText,
    emptyTranscriptMessage: emptyTranscriptText,
    onTranscript: (text) => {
      setTail(text);
      setLocalError('');
    },
    getLogDetails: () => ({
      sectionId: section?.id || '',
      blockId: resolvedPracticeBlock?.id || '',
    }),
  });

  const finalQuestion = questionDraft.trim() || builtQuestion;
  const speechLines = Array.isArray(brief?.speechLines) ? brief.speechLines : [];
  const speechParagraph = speechLines.map((line) => getSpeechLineText(line)).filter(Boolean).join(' ');
  const hasVideoSource = sourceMode === 'video' && Boolean(selectedVideo);
  const hasGeneratedSource = sourceMode === 'generated' && Boolean(brief);
  const hasActiveSource = hasVideoSource || hasGeneratedSource;
  const contextColumnTitle = contextBlock?.title || contextLeadIn;
  const contextColumnDescription = contextBlock?.description || dragPhraseHint;
  const followColumnTitle = followUpBlock?.title || followUpRequest;
  const followColumnDescription = followUpBlock?.description || dragPhraseHint;
  const builderTitle = resolvedPracticeBlock?.title || questionBuilderTitle;
  const builderDescription = resolvedPracticeBlock?.description || dragPhraseHint;

  function handlePhraseDrop(payload: PhraseDragPayload) {
    if (payload.slot === 'context') {
      setSelectedContextPhrase(payload.value);
      return;
    }

    setSelectedFollowPhrase(payload.value);
  }

  async function handleGenerate(nextOffset = 0) {
    setLoading(true);
    setLocalError('');
    setFeedback(null);
    clearSpeechStatus();

    try {
      const nextBrief = await apiClient.askAfter(context, nextOffset);
      setBrief(nextBrief);
      setSourceMode('generated');
      setTail(nextBrief.suggestedFocus || '');
      setQuestionDraft('');
      generatedQuestionRef.current = '';
      setOffset(nextOffset);
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleReviewQuestion() {
    try {
      setFeedback(await apiClient.checkAskAfter({
        question: finalQuestion,
        expectedQuestion: builtQuestion,
        detail: tail,
        contextPhrase: selectedContextPhrase,
        followUpPhrase: selectedFollowPhrase,
      }));
      setLocalError('');
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  function handleSelectVideo(id: string) {
    setSelectedVideoId(id);
    setSourceMode('video');
    setFeedback(null);
    setLocalError('');
    setQuestionDraft('');
    generatedQuestionRef.current = '';
  }

  function renderSelectedVideoSource() {
    if (!selectedVideo) {
      return null;
    }

    const mediaUrl = getMaterialUrl(selectedVideo);
    const embeddedUrl = getEmbeddedVideoUrl(mediaUrl);
    const isDirectVideo = directVideoPattern.test(mediaUrl);
    const transcriptText = videoTranscript || videoTranscriptStatus;

    return (
      <View style={styles.videoSourceShell}>
        <View style={styles.videoMainColumn}>
          <Text style={styles.eyebrow}>{videoSourceLabel}</Text>
          <Text style={styles.panelTitle}>{selectedVideo.title}</Text>
          {selectedVideo.body ? <Text style={styles.speechParagraph}>{selectedVideo.body}</Text> : null}
          <View style={styles.videoFrameBox}>
            {Platform.OS === 'web' && embeddedUrl && mediaActive ? (
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                src={embeddedUrl}
                style={webAskAfterFrameStyle}
                title="ask-after-video"
              />
            ) : null}
            {Platform.OS === 'web' && !embeddedUrl && isDirectVideo && mediaActive ? (
              <video controls playsInline preload="metadata" src={mediaUrl} style={webAskAfterVideoStyle}>
                <source src={mediaUrl} />
              </video>
            ) : null}
            {Platform.OS !== 'web' || (!embeddedUrl && !isDirectVideo) ? (
              <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(mediaUrl)}>
                <Text style={styles.secondaryText}>{openVideoLabel}</Text>
              </Pressable>
            ) : null}
          </View>
          {transcriptText ? (
            <View style={styles.videoTranscriptBox}>
              <ScrollView nestedScrollEnabled>
                <Text style={styles.videoTranscriptText}>{transcriptText}</Text>
              </ScrollView>
            </View>
          ) : null}
        </View>

        <View style={styles.videoLibraryColumn}>
          <Text style={styles.columnTitle}>{videoLibraryLabel}</Text>
          <Text style={styles.columnHint}>{videoLibraryHint}</Text>
          <View style={styles.videoList}>
            {videoMaterials.map((item) => {
              const itemUrl = getMaterialUrl(item);
              const thumbnail = getVideoThumbnailUrl(itemUrl, asString(asRecord(item.meta).thumbnail));
              const isActive = item.id === selectedVideo.id;
              return (
                <Pressable
                  key={item.id}
                  style={[styles.videoListItem, isActive ? styles.videoListItemActive : null]}
                  onPress={() => handleSelectVideo(item.id)}
                >
                  {thumbnail ? <Image source={{ uri: thumbnail }} style={styles.videoThumbnail} resizeMode="cover" /> : <View style={styles.videoThumbnailPlaceholder} />}
                  <View style={styles.videoListTextColumn}>
                    <Text style={styles.videoListTitle} numberOfLines={2}>{item.title}</Text>
                    {item.body ? <Text style={styles.videoListDescription} numberOfLines={2}>{item.body}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.label}>{yourWorkContext}</Text>
        <TextInput
          value={context}
          onChangeText={setContext}
          placeholder={askAfterContext}
          style={[styles.input, styles.textArea]}
          multiline
        />
        <Pressable style={[styles.button, loading ? styles.buttonDisabled : null]} onPress={() => void handleGenerate(0)} disabled={loading}>
          <Text style={styles.buttonText}>{generateShortTalk}</Text>
        </Pressable>
      </View>

      {videoMaterials.length ? (
        <View style={styles.card}>
          <Text style={styles.label}>{videoPracticeLibraryLabel}</Text>
          <Text style={styles.feedbackMuted}>{videoPracticeLibraryDescription}</Text>
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.secondaryButton, sourceMode === 'generated' ? styles.sourceButtonActive : null]}
              onPress={() => setSourceMode('generated')}
            >
              <Text style={[styles.secondaryText, sourceMode === 'generated' ? styles.sourceButtonTextActive : null]}>{generatedTalkSourceLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, sourceMode === 'video' ? styles.sourceButtonActive : null]}
              onPress={() => setSourceMode('video')}
            >
              <Text style={[styles.secondaryText, sourceMode === 'video' ? styles.sourceButtonTextActive : null]}>{videoTranscriptSourceLabel}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {localError ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackText}>{localError}</Text>
        </View>
      ) : null}

      {hasVideoSource ? renderSelectedVideoSource() : null}

      {hasGeneratedSource ? (
        <View style={styles.panel}>
          <Text style={styles.eyebrow}>{generatedTalkEyebrow}</Text>
          <Text style={styles.panelTitle}>{generatedTalkTitle}</Text>
          <Text style={styles.speechParagraph}>{speechParagraph}</Text>
          <Text style={styles.tip}><Text style={styles.tipStrong}>{coachingTip}: </Text>{brief?.coachingTip}</Text>
        </View>
      ) : null}

      {!hasActiveSource ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackMuted}>{askAfterEmpty}</Text>
        </View>
      ) : (
        <>
          <View style={styles.builderShell}>
            <View style={styles.banksRow}>
              <View style={styles.bankColumn}>
                <Text style={styles.columnTitle}>{contextColumnTitle}</Text>
                <Text style={styles.columnHint}>{contextColumnDescription}</Text>
                <View style={styles.bankList}>
                  {contextPhrases.map((item) => (
                    <Pressable
                      key={item}
                      {...(createPhraseDragProps('context', item) as any)}
                      style={[styles.bankItem, selectedContextPhrase === item ? styles.bankItemActive : null]}
                      onPress={() => setSelectedContextPhrase(item)}
                    >
                      <Text style={[styles.bankItemText, selectedContextPhrase === item ? styles.bankItemTextActive : null]}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.bankColumn}>
                <Text style={styles.columnTitle}>{followColumnTitle}</Text>
                <Text style={styles.columnHint}>{followColumnDescription}</Text>
                <View style={styles.bankList}>
                  {followUpPhrases.map((item) => (
                    <Pressable
                      key={item}
                      {...(createPhraseDragProps('follow', item) as any)}
                      style={[styles.bankItem, selectedFollowPhrase === item ? styles.bankItemActive : null]}
                      onPress={() => setSelectedFollowPhrase(item)}
                    >
                      <Text style={[styles.bankItemText, selectedFollowPhrase === item ? styles.bankItemTextActive : null]}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.builderColumn}>
              <View style={styles.builderMeta}>
                <Text style={styles.builderMetaEyebrow}>{questionBuilderTitle}</Text>
                <Text style={styles.builderMetaTitle}>{builderTitle}</Text>
                <Text style={styles.builderMetaDescription}>{builderDescription}</Text>
              </View>

              <View style={styles.previewHeroCard}>
                <Text style={styles.previewLabel}>{questionPreviewLabel}</Text>
                <TextInput
                  value={questionDraft}
                  onChangeText={setQuestionDraft}
                  placeholder={builtQuestion || askAfterTail}
                  style={[styles.input, styles.previewHeroInput]}
                  multiline
                />
              </View>

              <View style={styles.builderSlot} {...(createPhraseDropProps('context', handlePhraseDrop) as any)}>
                <Text style={styles.slotLabel}>{contextLeadIn}</Text>
                <Text style={[styles.slotValue, !selectedContextPhrase ? styles.slotValueMuted : null]}>
                  {getPhraseDisplayText(selectedContextPhrase, 'context') || dragPhraseHint}
                </Text>
              </View>

              <View style={styles.builderSlot}>
                <Text style={styles.slotLabel}>{topicToFocusOn}</Text>
                <TextInput
                  value={tail}
                  onChangeText={setTail}
                  placeholder={askAfterTail}
                  style={[styles.input, styles.slotInput]}
                  multiline
                />
                <View style={styles.actionsRow}>
                  <Pressable style={[styles.button, recording || transcribing ? styles.buttonDisabled : null]} onPress={() => void startRecording()} disabled={recording || transcribing}>
                    <Text style={styles.buttonText}>{startRecordingLabel}</Text>
                  </Pressable>
                  <Pressable style={[styles.secondaryButton, !recording ? styles.buttonDisabled : null]} onPress={stopRecording} disabled={!recording}>
                    <Text style={styles.secondaryText}>{stopRecordingLabel}</Text>
                  </Pressable>
                </View>
                {transcribing ? (
                  <View style={styles.noticeCard}>
                    <Text style={styles.noticeText}>{transcribingText}</Text>
                  </View>
                ) : null}
                {speechStatus ? (
                  <View style={styles.noticeCard}>
                    <Text style={styles.noticeText}>{speechStatus}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.builderSlot} {...(createPhraseDropProps('follow', handlePhraseDrop) as any)}>
                <Text style={styles.slotLabel}>{followUpRequest}</Text>
                <Text style={[styles.slotValue, !selectedFollowPhrase ? styles.slotValueMuted : null]}>
                  {getPhraseDisplayText(selectedFollowPhrase, 'follow') || dragPhraseHint}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.actionsRow}>
            <Pressable style={styles.button} onPress={() => void handleReviewQuestion()}>
              <Text style={styles.buttonText}>{reviewQuestion}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => void handleGenerate(offset + 1)}>
              <Text style={styles.secondaryText}>{generateAnotherTalk}</Text>
            </Pressable>
          </View>

          {feedback ? (
            <View style={[styles.feedbackCard, feedback.accepted ? styles.feedbackCardSuccess : null]}>
              <Text style={[styles.feedbackText, feedback.accepted ? styles.feedbackTextSuccess : null]}>{feedback.feedback}</Text>
            </View>
          ) : null}
        </>
      )}
    </>
  );
}

const webAskAfterFrameStyle = {
  width: '100%',
  height: '100%',
  border: 0,
  backgroundColor: '#000',
};

const webAskAfterVideoStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  backgroundColor: '#000',
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  panel: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  videoSourceShell: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.md,
    alignItems: 'stretch',
  },
  videoMainColumn: {
    flex: 1,
    minWidth: 320,
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  videoLibraryColumn: {
    width: 320,
    maxWidth: '100%',
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  videoFrameBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    maxHeight: 520,
    borderRadius: tokens.radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoTranscriptBox: {
    maxHeight: 220,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  videoTranscriptText: {
    color: tokens.colors.inkSoft,
    lineHeight: 21,
  },
  videoList: {
    gap: tokens.spacing.sm,
  },
  videoListItem: {
    flexDirection: 'row',
    gap: tokens.spacing.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    backgroundColor: tokens.colors.surface,
    padding: 8,
  },
  videoListItemActive: {
    borderColor: tokens.colors.accent,
    backgroundColor: tokens.colors.accentSoft,
  },
  videoThumbnail: {
    width: 118,
    aspectRatio: 16 / 9,
    borderRadius: tokens.radius.sm,
    backgroundColor: '#000',
  },
  videoThumbnailPlaceholder: {
    width: 118,
    aspectRatio: 16 / 9,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.colors.surfaceStrong,
  },
  videoListTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  videoListTitle: {
    color: tokens.colors.ink,
    fontWeight: '800',
    lineHeight: 18,
  },
  videoListDescription: {
    color: tokens.colors.inkSoft,
    lineHeight: 16,
    fontSize: 12,
  },
  builderShell: {
    flexDirection: 'column',
    gap: tokens.spacing.md,
    alignItems: 'stretch',
  },
  banksRow: {
    flexDirection: 'row',
    gap: tokens.spacing.md,
    alignItems: 'stretch',
  },
  bankColumn: {
    flex: 1,
    minWidth: 0,
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  builderColumn: {
    width: '100%',
    minWidth: 0,
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  builderMeta: {
    gap: 6,
  },
  bankList: {
    gap: tokens.spacing.sm,
  },
  bankItem: {
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    backgroundColor: tokens.colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bankItemActive: {
    borderColor: tokens.colors.accent,
    backgroundColor: tokens.colors.accentSoft,
  },
  bankItemText: {
    color: tokens.colors.ink,
    lineHeight: 22,
    fontWeight: '700',
  },
  bankItemTextActive: {
    color: tokens.colors.accentDeep,
  },
  builderMetaEyebrow: {
    color: tokens.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '800',
    fontSize: 11,
  },
  builderMetaTitle: {
    color: tokens.colors.inkSoft,
    fontWeight: '800',
    fontSize: 16,
    lineHeight: 20,
  },
  builderMetaDescription: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
    fontSize: 14,
  },
  builderSlot: {
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.colors.cardLine,
    backgroundColor: tokens.colors.surfaceMuted,
    padding: tokens.spacing.md,
    gap: tokens.spacing.sm,
  },
  slotLabel: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 12,
  },
  slotValue: {
    color: tokens.colors.ink,
    fontWeight: '700',
    lineHeight: 24,
    fontSize: 18,
  },
  slotValueMuted: {
    color: tokens.colors.inkSoft,
    fontWeight: '600',
    fontSize: 15,
  },
  slotInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  columnTitle: {
    color: tokens.colors.ink,
    fontWeight: '900',
    fontSize: 22,
    lineHeight: 26,
  },
  columnHint: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
  },
  previewHeroCard: {
    backgroundColor: '#fffaf3',
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 2,
    borderColor: tokens.colors.accent,
    gap: tokens.spacing.md,
    shadowColor: 'rgba(141,38,0,0.18)',
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  previewLabel: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
  },
  previewHeroInput: {
    minHeight: 148,
    fontSize: 24,
    lineHeight: 34,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderRadius: tokens.radius.lg,
    borderColor: 'rgba(141,38,0,0.12)',
    backgroundColor: tokens.colors.surface,
  },
  label: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
  },
  input: {
    width: '100%',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    backgroundColor: tokens.colors.surface,
    color: tokens.colors.ink,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  eyebrow: {
    color: tokens.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '800',
    fontSize: 12,
  },
  panelTitle: {
    color: tokens.colors.ink,
    fontWeight: '900',
    fontSize: 22,
    lineHeight: 28,
  },
  speechParagraph: {
    color: tokens.colors.ink,
    lineHeight: 24,
  },
  tip: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  tipStrong: {
    color: tokens.colors.ink,
    fontWeight: '800',
  },
  button: {
    minHeight: 48,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: tokens.colors.accentContrast,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: tokens.colors.ink,
    fontWeight: '700',
  },
  sourceButtonActive: {
    backgroundColor: tokens.colors.accent,
    borderColor: tokens.colors.accent,
  },
  sourceButtonTextActive: {
    color: tokens.colors.accentContrast,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  noticeCard: {
    borderRadius: tokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: tokens.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  noticeText: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
  },
  feedbackCard: {
    backgroundColor: '#fff2ec',
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(141,38,0,0.18)',
  },
  feedbackCardSuccess: {
    backgroundColor: '#eefcf3',
    borderColor: 'rgba(22,115,60,0.2)',
  },
  feedbackText: {
    color: tokens.colors.danger,
    lineHeight: 22,
  },
  feedbackTextSuccess: {
    color: tokens.colors.success,
  },
  feedbackMuted: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
});
