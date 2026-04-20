import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppContent, AskAfterBrief, AskAfterSpeechLine, ContentBlock, ContentSection } from '@softskills/domain';
import { useSpeechDraft } from '../../hooks/useSpeechDraft';
import { apiClient } from '../../lib/api';
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

type PhraseDragPayload = {
  slot: PhraseSlot;
  value: string;
};

type AskAfterComposerProps = {
  content: AppContent | null | undefined;
  section?: ContentSection | null;
  practiceBlock?: ContentBlock | null;
};

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' ? value : fallback;
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
  const ui = getUiConfig(content);
  const practiceConfig = getPracticeScreenConfig(content, 'askAfter');
  const blockGroup = getBlockGroupConfig(content, 'askAfter');
  const practiceRenderer = getNestedString(practiceConfig, ['blockRenderer']);
  const resolvedPracticeBlock = practiceBlock || findFirstBlockByRenderer(content, section || undefined, practiceRenderer);

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

  const [context, setContext] = useState('');
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

      {localError ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackText}>{localError}</Text>
        </View>
      ) : null}

      {!brief ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackMuted}>{askAfterEmpty}</Text>
        </View>
      ) : (
        <>
          <View style={styles.panel}>
            <Text style={styles.eyebrow}>{generatedTalkEyebrow}</Text>
            <Text style={styles.panelTitle}>{generatedTalkTitle}</Text>
            <Text style={styles.speechParagraph}>{speechParagraph}</Text>
            <Text style={styles.tip}><Text style={styles.tipStrong}>{coachingTip}: </Text>{brief.coachingTip}</Text>
          </View>

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
