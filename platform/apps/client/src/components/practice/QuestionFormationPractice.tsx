import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppContent, ContentBlock, ContentSection, QuestionFormationBlank, QuestionFormationExercise } from '@softskills/domain';
import { useSpeechDraft } from '../../hooks/useSpeechDraft';
import { apiClient } from '../../lib/api';
import { getNestedNumber, getNestedString, getPracticeConfig, getUiConfig } from '../../lib/contentMeta';
import { tokens } from '../../theme/tokens';

type BlankResult = {
  status: 'correct' | 'incorrect';
  feedback: string;
};

function normalizeText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatTemplate(template: string, values: Record<string, string>) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_match, key) => values[key] ?? '');
}

function getBlankKey(blank: QuestionFormationBlank) {
  return blank.id || `blank-${blank.index}`;
}

function renderHighlightedSentence(
  exercise: QuestionFormationExercise,
  targetsVisible: boolean,
  results: Record<string, BlankResult>,
) {
  const pieces: Array<{ text: string; blank?: QuestionFormationBlank }> = [];
  const sentence = exercise.sentence;
  let cursor = 0;

  for (const blank of [...exercise.blanks].sort((left, right) => left.index - right.index)) {
    const answer = normalizeText(blank.answer);
    if (!answer) {
      continue;
    }

    const source = sentence.toLowerCase();
    const target = answer.toLowerCase();
    const start = source.indexOf(target, cursor);
    if (start < 0) {
      continue;
    }

    if (start > cursor) {
      pieces.push({ text: sentence.slice(cursor, start) });
    }
    pieces.push({ text: sentence.slice(start, start + answer.length), blank });
    cursor = start + answer.length;
  }

  if (cursor < sentence.length) {
    pieces.push({ text: sentence.slice(cursor) });
  }

  return (
    <Text style={styles.sentenceText}>
      {pieces.map((piece, index) => {
        if (!piece.blank) {
          return <Text key={`text-${index}`}>{piece.text}</Text>;
        }

        const result = results[getBlankKey(piece.blank)];
        if (result?.status === 'correct') {
          return <Text key={piece.blank.id} style={styles.correctAnswer}>{piece.text}</Text>;
        }

        if (targetsVisible) {
          return <Text key={piece.blank.id} style={styles.targetAnswer}>{piece.text}</Text>;
        }

        return (
          <Text key={piece.blank.id} style={styles.hiddenTargetPlaceholder}>
            {`__(${piece.blank.index})__`}
          </Text>
        );
      })}
    </Text>
  );
}

export function QuestionFormationPractice({
  content,
  section,
  block,
}: {
  content: AppContent | null | undefined;
  section?: ContentSection | null;
  block: ContentBlock;
}) {
  const ui = getUiConfig(content);
  const practiceConfig = getPracticeConfig(content);
  const [exercise, setExercise] = useState<QuestionFormationExercise | null>(null);
  const [targetsVisible, setTargetsVisible] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, BlankResult>>({});
  const [feedbackByBlank, setFeedbackByBlank] = useState<Record<string, string>>({});
  const [hintsByBlank, setHintsByBlank] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const activeBlankRef = useRef('');
  const roundTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sentenceLabel = getNestedString(ui, ['labels', 'questionFormationSentence']);
  const questionLabelTemplate = getNestedString(ui, ['labels', 'questionFormationQuestionLabel']);
  const roundDurationMs = Math.max(1000, getNestedNumber(practiceConfig, ['questionFormationRoundDurationMs'], 60000));
  const visibleDurationMs = Math.max(1000, getNestedNumber(practiceConfig, ['questionFormationVisibleDurationMs'], 15000));
  const hiddenDurationMs = Math.max(1000, getNestedNumber(practiceConfig, ['questionFormationHiddenDurationMs'], 30000));
  const countdownLabelTemplate = getNestedString(ui, ['labels', 'questionFormationCountdown']);
  const loadingText = getNestedString(ui, ['feedback', 'questionFormationLoading']);
  const allDoneText = getNestedString(ui, ['feedback', 'questionFormationAllDone']);
  const hintFeedbackTemplate = getNestedString(ui, ['feedback', 'questionFormationHintUsed']);
  const recordingUnavailableText = getNestedString(ui, ['feedback', 'speechRecordingUnavailable']);
  const emptyTranscriptText = getNestedString(ui, ['feedback', 'speechTranscriptEmpty']);
  const transcribingText = getNestedString(ui, ['feedback', 'speechTranscribing']);
  const startRecordingLabel = getNestedString(ui, ['buttons', 'startRecording']);
  const stopRecordingLabel = getNestedString(ui, ['buttons', 'stopRecording']);
  const checkAnswerLabel = getNestedString(ui, ['buttons', 'checkCorrectness'], getNestedString(ui, ['buttons', 'checkAnswer']));
  const showHintLabel = getNestedString(ui, ['buttons', 'showHint']);
  const nextSentenceLabel = getNestedString(ui, ['buttons', 'nextSentence']);
  const questionPlaceholder = getNestedString(ui, ['placeholders', 'questionFormationAnswer']);

  async function loadExercise(nextOffset: number) {
    setLoading(true);
    setLocalError('');
    setDrafts({});
    setResults({});
    setFeedbackByBlank({});
    setHintsByBlank({});
    setTargetsVisible(true);
    setSecondsRemaining(Math.ceil(roundDurationMs / 1000));
    clearInterval(roundTimerRef.current || undefined);
    clearTimeout(advanceTimerRef.current || undefined);

    try {
      const nextExercise = await apiClient.generateQuestionFormation(section?.summary || section?.title || '', nextOffset);
      setExercise(nextExercise);
      setOffset(nextOffset);
      const startedAt = Date.now();
      roundTimerRef.current = setInterval(() => {
        const elapsedMs = Date.now() - startedAt;
        const remainingMs = Math.max(0, roundDurationMs - elapsedMs);
        const cycleMs = visibleDurationMs + hiddenDurationMs;
        const cyclePosition = cycleMs > 0 ? elapsedMs % cycleMs : 0;

        setSecondsRemaining(Math.ceil(remainingMs / 1000));
        setTargetsVisible(cyclePosition < visibleDurationMs);

        if (remainingMs <= 0) {
          clearInterval(roundTimerRef.current || undefined);
          void loadExercise(nextOffset + 1);
        }
      }, 1000);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  const {
    recording,
    transcribing,
    speechStatus,
    startRecording,
    stopRecording,
    clearSpeechStatus,
  } = useSpeechDraft({
    scope: 'question-formation',
    unsupportedMessage: recordingUnavailableText,
    emptyTranscriptMessage: emptyTranscriptText,
    onTranscript: (text) => {
      const blankId = activeBlankRef.current;
      if (!blankId) {
        return;
      }

      setDrafts((current) => ({ ...current, [blankId]: text }));
      setFeedbackByBlank((current) => ({ ...current, [blankId]: '' }));
    },
    getLogDetails: () => ({
      sectionId: section?.id || '',
      blockId: block.id,
      blankId: activeBlankRef.current,
    }),
  });

  useEffect(() => {
    void loadExercise(0);
    return () => {
      clearInterval(roundTimerRef.current || undefined);
      clearTimeout(advanceTimerRef.current || undefined);
    };
  }, [section?.id, block.id]);

  useEffect(() => {
    if (!exercise?.blanks.length) {
      return;
    }

    const completed = exercise.blanks.every((blank) => results[getBlankKey(blank)]?.status === 'correct');
    if (!completed) {
      return;
    }

    clearTimeout(advanceTimerRef.current || undefined);
    clearInterval(roundTimerRef.current || undefined);
    advanceTimerRef.current = setTimeout(() => {
      void loadExercise(offset + 1);
    }, 1400);
  }, [exercise, results, offset]);

  function updateDraft(blankId: string, value: string) {
    setDrafts((current) => ({ ...current, [blankId]: value }));
    setFeedbackByBlank((current) => ({ ...current, [blankId]: '' }));
  }

  async function handleCheck(blank: QuestionFormationBlank) {
    if (!exercise) {
      return;
    }

    const blankId = getBlankKey(blank);
    try {
      const result = await apiClient.checkQuestionFormation({
        userQuestion: drafts[blankId] || '',
        sentence: exercise.sentence,
        answer: blank.answer,
        whWord: blank.whWord,
        expectedQuestion: blank.expectedQuestion,
        acceptedQuestions: blank.acceptedQuestions,
      });

      setResults((current) => {
        if (result.accepted) {
          return {
            ...current,
            [blankId]: {
              status: 'correct',
              feedback: result.feedback,
            },
          };
        }

        if (!String(drafts[blankId] || '').trim()) {
          return current;
        }

        return {
          ...current,
          [blankId]: {
            status: 'incorrect',
            feedback: result.feedback,
          },
        };
      });

      setFeedbackByBlank((current) => ({
        ...current,
        [blankId]: result.feedback,
      }));
    } catch (error) {
      setFeedbackByBlank((current) => ({
        ...current,
        [blankId]: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  function handleShowHint(blank: QuestionFormationBlank) {
    const blankId = getBlankKey(blank);
    const feedback = formatTemplate(hintFeedbackTemplate, { whWord: blank.whWord });
    setHintsByBlank((current) => ({ ...current, [blankId]: `${blank.whWord} ...?` }));
    setFeedbackByBlank((current) => ({ ...current, [blankId]: feedback }));
  }

  async function handleStartRecording(blankId: string) {
    activeBlankRef.current = blankId;
    clearSpeechStatus();
    await startRecording();
  }

  const completedCount = exercise?.blanks.filter((blank) => results[getBlankKey(blank)]?.status === 'correct').length || 0;
  const allDone = Boolean(exercise?.blanks.length && completedCount === exercise.blanks.length);

  return (
    <View style={styles.card}>
      <Text style={styles.blockTitle}>{block.title}</Text>
      {block.description ? <Text style={styles.blockDescription}>{block.description}</Text> : null}

      {loading ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeText}>{loadingText}</Text>
        </View>
      ) : null}

      {localError ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackText}>{localError}</Text>
        </View>
      ) : null}

      {exercise ? (
        <>
          <View style={styles.sentenceCard}>
            <View style={styles.sentenceHeader}>
              <Text style={styles.label}>{sentenceLabel}</Text>
              <View style={styles.countdownPill}>
                <Text style={styles.countdownText}>
                  {formatTemplate(countdownLabelTemplate, { seconds: String(secondsRemaining) })}
                </Text>
              </View>
            </View>
            {renderHighlightedSentence(exercise, targetsVisible, results)}
          </View>

          <View style={styles.questionList}>
            {exercise.blanks.map((blank) => {
              const blankId = getBlankKey(blank);
              const result = results[blankId];
              const hint = hintsByBlank[blankId];
              const disabled = result?.status === 'correct' || recording || transcribing;

              return (
                <View key={blankId} style={styles.questionCard}>
                  <Text style={styles.label}>
                    {formatTemplate(questionLabelTemplate, {
                      index: String(blank.index),
                    })}
                  </Text>
                  {hint ? (
                    <View style={styles.hintCard}>
                      <Text style={styles.hintText}>{hint}</Text>
                    </View>
                  ) : null}
                  <TextInput
                    value={drafts[blankId] || ''}
                    onChangeText={(value) => updateDraft(blankId, value)}
                    placeholder={hint || questionPlaceholder}
                    style={[styles.input, result?.status === 'correct' ? styles.inputDisabled : null]}
                    multiline
                    editable={result?.status !== 'correct'}
                  />
                  <View style={styles.actionsRow}>
                    <Pressable
                      style={[styles.button, disabled ? styles.buttonDisabled : null]}
                      onPress={() => void handleStartRecording(blankId)}
                      disabled={disabled}
                    >
                      <Text style={styles.buttonText}>{startRecordingLabel}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, !(recording && activeBlankRef.current === blankId) ? styles.buttonDisabled : null]}
                      onPress={stopRecording}
                      disabled={!(recording && activeBlankRef.current === blankId)}
                    >
                      <Text style={styles.buttonText}>{stopRecordingLabel}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, disabled ? styles.buttonDisabled : null]}
                      onPress={() => void handleCheck(blank)}
                      disabled={disabled}
                    >
                      <Text style={styles.buttonText}>{checkAnswerLabel}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, result?.status === 'correct' ? styles.buttonDisabled : null]}
                      onPress={() => handleShowHint(blank)}
                      disabled={result?.status === 'correct'}
                    >
                      <Text style={styles.buttonText}>{showHintLabel}</Text>
                    </Pressable>
                  </View>
                  {transcribing && activeBlankRef.current === blankId ? (
                    <View style={styles.noticeCard}>
                      <Text style={styles.noticeText}>{transcribingText}</Text>
                    </View>
                  ) : null}
                  {speechStatus && activeBlankRef.current === blankId ? (
                    <View style={styles.noticeCard}>
                      <Text style={styles.noticeText}>{speechStatus}</Text>
                    </View>
                  ) : null}
                  {feedbackByBlank[blankId] ? (
                    <View style={[styles.feedbackCard, result?.status === 'correct' ? styles.feedbackCardSuccess : result?.status === 'incorrect' ? styles.feedbackCardWarning : null]}>
                      <Text style={[styles.feedbackText, result?.status === 'correct' ? styles.feedbackTextSuccess : result?.status === 'incorrect' ? styles.feedbackTextWarning : null]}>
                        {feedbackByBlank[blankId]}
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {allDone ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>{allDoneText}</Text>
            </View>
          ) : null}

          <Pressable style={styles.secondaryButtonWide} onPress={() => void loadExercise(offset + 1)}>
            <Text style={styles.buttonText}>{nextSentenceLabel}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  blockTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  blockDescription: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  sentenceCard: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  sentenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacing.sm,
    flexWrap: 'wrap',
  },
  countdownPill: {
    backgroundColor: tokens.colors.accent,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
  },
  countdownText: {
    color: '#fff',
    fontWeight: '900',
  },
  sentenceText: {
    color: tokens.colors.ink,
    fontSize: 28,
    lineHeight: 38,
    fontWeight: '800',
  },
  targetAnswer: {
    color: tokens.colors.accentDeep,
    fontWeight: '900',
  },
  correctAnswer: {
    color: '#23824a',
    fontWeight: '900',
  },
  hiddenTargetAnswer: {
    color: 'transparent',
    fontWeight: '900',
  },
  hiddenTargetPlaceholder: {
    color: tokens.colors.accentDeep,
    fontWeight: '900',
  },
  mutedText: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  questionList: {
    gap: tokens.spacing.md,
  },
  questionCard: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  label: {
    color: tokens.colors.accentDeep,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 76,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    backgroundColor: tokens.colors.surfaceMuted,
    color: tokens.colors.ink,
    padding: tokens.spacing.md,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  inputDisabled: {
    opacity: 0.75,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  button: {
    minHeight: 44,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '900',
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.accent,
    borderWidth: 1,
    borderColor: tokens.colors.accentDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonWide: {
    minHeight: 48,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    backgroundColor: tokens.colors.accent,
    borderWidth: 1,
    borderColor: tokens.colors.accentDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: '#fff',
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  hintCard: {
    alignSelf: 'flex-start',
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  hintText: {
    color: tokens.colors.accentDeep,
    fontWeight: '900',
  },
  noticeCard: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  noticeText: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  feedbackCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  feedbackCardSuccess: {
    backgroundColor: '#ecf8f0',
    borderColor: '#bfe6cc',
  },
  feedbackCardWarning: {
    backgroundColor: '#fff1ec',
    borderColor: '#f0c7bb',
  },
  feedbackText: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  feedbackTextSuccess: {
    color: '#236b42',
  },
  feedbackTextWarning: {
    color: tokens.colors.danger,
  },
});
