import { useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppContent, ContentBlock, ContentMaterial, ContentSection } from '@softskills/domain';
import { useSpeechDraft } from '../../hooks/useSpeechDraft';
import { apiClient, resolveApiUrl } from '../../lib/api';
import { getNestedString, getUiConfig } from '../../lib/contentMeta';
import { tokens } from '../../theme/tokens';

type ClarifyExample = {
  id: string;
  title: string;
  description: string;
  audioUrl: string;
  expectedQuestion: string;
  acceptedAnswers: string[];
  placeholder: string;
};

type FeedbackState = {
  accepted: boolean;
  text: string;
  showExpected: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function buildClarifyExamples(block: ContentBlock | null | undefined) {
  return (block?.materials ?? [])
    .filter((material): material is ContentMaterial => material.type === 'audio')
    .map((material) => {
      const meta = asRecord(material.meta);
      return {
        id: material.id,
        title: material.title || material.id,
        description: material.body,
        audioUrl: material.url ? resolveApiUrl(material.url) : '',
        expectedQuestion: asString(meta.clarification),
        acceptedAnswers: asStringArray(meta.acceptedAnswers),
        placeholder: asString(meta.placeholder),
      } satisfies ClarifyExample;
    })
    .filter((example) => example.expectedQuestion.trim().length > 0);
}

function BrowserAudioPlayer({ url }: { url: string }) {
  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.audioShell}>
      <audio controls preload="metadata" src={url} style={webAudioStyle} />
    </View>
  );
}

export function ClarifyPracticeInlineList({
  content,
  section,
  block,
}: {
  content: AppContent | null | undefined;
  section?: ContentSection | null;
  block: ContentBlock;
}) {
  const ui = getUiConfig(content);
  const examples = buildClarifyExamples(block);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [feedbackById, setFeedbackById] = useState<Record<string, FeedbackState>>({});
  const activeSpeechTargetRef = useRef('');
  const [activeSpeechTargetId, setActiveSpeechTargetId] = useState('');
  const [speechStatusById, setSpeechStatusById] = useState<Record<string, string>>({});

  const missingAudioText = getNestedString(ui, ['feedback', 'clarifyAudioMissing']);
  const recordingUnavailableText = getNestedString(ui, ['feedback', 'speechRecordingUnavailable']);
  const emptyTranscriptText = getNestedString(ui, ['feedback', 'speechTranscriptEmpty']);
  const answerRequiredText = getNestedString(ui, ['feedback', 'clarifyAnswerRequired']);
  const transcribingText = getNestedString(ui, ['feedback', 'speechTranscribing']);
  const yourQuestionLabel = getNestedString(ui, ['labels', 'yourClarifyingQuestion']);
  const expectedAnswerLabel = getNestedString(ui, ['labels', 'expectedAnswer']);
  const startRecordingLabel = getNestedString(ui, ['buttons', 'startRecording']);
  const stopRecordingLabel = getNestedString(ui, ['buttons', 'stopRecording']);
  const checkAnswerLabel = getNestedString(ui, ['buttons', 'checkAnswer']);
  const showExpectedLabel = getNestedString(ui, ['buttons', 'showExpectedAnswer']);
  const openMediaLabel = getNestedString(ui, ['buttons', 'openMedia']);
  const answerPlaceholder = getNestedString(ui, ['placeholders', 'clarifyAnswer']);

  function updateDraft(exampleId: string, value: string) {
    setDrafts((current) => ({ ...current, [exampleId]: value }));
  }

  function setSpeechStatus(exampleId: string, text: string) {
    setSpeechStatusById((current) => ({ ...current, [exampleId]: text }));
  }

  const {
    recording,
    transcribing,
    speechStatus,
    startRecording,
    stopRecording,
    clearSpeechStatus,
  } = useSpeechDraft({
    scope: 'clarify-inline',
    unsupportedMessage: recordingUnavailableText,
    emptyTranscriptMessage: emptyTranscriptText,
    onTranscript: (text) => {
      const targetId = activeSpeechTargetRef.current;
      if (!targetId) {
        return;
      }

      updateDraft(targetId, text);
      setSpeechStatus(targetId, '');
    },
    getLogDetails: () => ({
      sectionId: section?.id || '',
      blockId: block.id,
      exampleId: activeSpeechTargetRef.current,
    }),
  });

  async function handleCheckAnswer(example: ClarifyExample) {
    const userQuestion = String(drafts[example.id] || '').trim();
    if (!userQuestion) {
      setFeedbackById((current) => ({
        ...current,
        [example.id]: {
          accepted: false,
          text: answerRequiredText,
          showExpected: false,
        },
      }));
      return;
    }

    try {
      const result = await apiClient.checkClarify({
        userQuestion,
        expectedQuestion: example.expectedQuestion,
        acceptedAnswers: example.acceptedAnswers,
      });
      setFeedbackById((current) => ({
        ...current,
        [example.id]: {
          accepted: result.accepted,
          text: result.feedback,
          showExpected: Boolean(result.accepted),
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedbackById((current) => ({
        ...current,
        [example.id]: {
          accepted: false,
          text: message,
          showExpected: false,
        },
      }));
    }
  }

  function handleShowExpectedAnswer(example: ClarifyExample) {
    setFeedbackById((current) => ({
      ...current,
      [example.id]: {
        accepted: current[example.id]?.accepted || false,
        text: current[example.id]?.text || '',
        showExpected: true,
      },
    }));
  }

  async function handleStartRecording(exampleId: string) {
    activeSpeechTargetRef.current = exampleId;
    setActiveSpeechTargetId(exampleId);
    setSpeechStatus(exampleId, '');
    clearSpeechStatus();
    await startRecording();
  }

  function handleStopRecording() {
    stopRecording();
  }

  if (!examples.length) {
    return null;
  }

  return (
    <View style={styles.practiceCard}>
      <Text style={styles.blockTitle}>{block.title}</Text>
      {block.description ? <Text style={styles.blockDescription}>{block.description}</Text> : null}

      <View style={styles.exampleList}>
        {examples.map((example) => {
          const feedback = feedbackById[example.id];
          const speechMessage = activeSpeechTargetId === example.id ? (speechStatusById[example.id] || speechStatus) : speechStatusById[example.id];
          const isRecordingCurrent = recording && activeSpeechTargetId === example.id;
          const isTranscribingCurrent = transcribing && activeSpeechTargetId === example.id;

          return (
            <View key={example.id} style={styles.exampleCard}>
              <Text style={styles.materialLabel}>{example.title}</Text>
              {example.audioUrl ? (
                <>
                  <BrowserAudioPlayer url={example.audioUrl} />
                  {Platform.OS !== 'web' ? (
                    <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(example.audioUrl)}>
                      <Text style={styles.secondaryText}>{openMediaLabel}</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackText}>{missingAudioText}</Text>
                </View>
              )}

              {example.description ? <Text style={styles.description}>{example.description}</Text> : null}

              <View style={styles.inlineActions}>
                <Pressable
                  style={[styles.button, (recording || transcribing) ? styles.buttonDisabled : null]}
                  onPress={() => void handleStartRecording(example.id)}
                  disabled={recording || transcribing}
                >
                  <Text style={styles.buttonText}>{startRecordingLabel}</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryButton, !isRecordingCurrent ? styles.buttonDisabled : null]}
                  onPress={handleStopRecording}
                  disabled={!isRecordingCurrent}
                >
                  <Text style={styles.secondaryText}>{stopRecordingLabel}</Text>
                </Pressable>
              </View>

              {isTranscribingCurrent ? (
                <View style={styles.noticeCard}>
                  <Text style={styles.noticeText}>{transcribingText}</Text>
                </View>
              ) : null}
              {speechMessage ? (
                <View style={styles.noticeCard}>
                  <Text style={styles.noticeText}>{speechMessage}</Text>
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>{yourQuestionLabel}</Text>
              <TextInput
                value={drafts[example.id] || ''}
                onChangeText={(value) => updateDraft(example.id, value)}
                placeholder={example.placeholder || answerPlaceholder}
                style={[styles.input, styles.inputLarge]}
                multiline
              />

              <View style={styles.inlineActions}>
                <Pressable style={styles.button} onPress={() => void handleCheckAnswer(example)}>
                  <Text style={styles.buttonText}>{checkAnswerLabel}</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => handleShowExpectedAnswer(example)}>
                  <Text style={styles.secondaryText}>{showExpectedLabel}</Text>
                </Pressable>
              </View>

              {feedback ? (
                <View style={[styles.feedbackCard, feedback.accepted ? styles.feedbackCardSuccess : null]}>
                  <Text style={[styles.feedbackText, feedback.accepted ? styles.feedbackTextSuccess : null]}>{feedback.text}</Text>
                </View>
              ) : null}

              {feedback?.showExpected ? (
                <View style={styles.expectedCard}>
                  <Text style={styles.expectedLabel}>{expectedAnswerLabel}</Text>
                  <Text style={styles.expectedText}>{example.expectedQuestion}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const webAudioStyle = {
  width: '100%',
};

const styles = StyleSheet.create({
  practiceCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  blockTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  blockDescription: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  exampleList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.md,
  },
  exampleCard: {
    width: '100%',
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  materialLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  description: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
  },
  audioShell: {
    width: '100%',
  },
  fieldLabel: {
    color: tokens.colors.ink,
    fontWeight: '800',
  },
  input: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    color: tokens.colors.ink,
    minHeight: 52,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  inputLarge: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  button: {
    backgroundColor: tokens.colors.accent,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  secondaryText: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  noticeCard: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: '#fff6ea',
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  noticeText: {
    color: tokens.colors.accentDeep,
    lineHeight: 22,
  },
  feedbackCard: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: '#fff1ed',
    borderWidth: 1,
    borderColor: '#f2c5b5',
  },
  feedbackCardSuccess: {
    backgroundColor: 'rgba(232,255,240,0.86)',
    borderColor: 'rgba(32,101,58,0.2)',
  },
  feedbackText: {
    color: tokens.colors.danger,
    lineHeight: 22,
  },
  feedbackTextSuccess: {
    color: tokens.colors.success,
  },
  expectedCard: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.xs,
  },
  expectedLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  expectedText: {
    color: tokens.colors.ink,
    lineHeight: 22,
    fontWeight: '700',
  },
});
