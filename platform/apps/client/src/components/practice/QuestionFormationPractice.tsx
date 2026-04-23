import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppContent, ContentBlock, ContentSection, QuestionFormationBlank, QuestionFormationExercise } from '@softskills/domain';
import { useSpeechDraft } from '../../hooks/useSpeechDraft';
import { apiClient } from '../../lib/api';
import { getNestedNumber, getNestedString, getPracticeConfig, getUiConfig } from '../../lib/contentMeta';
import { tokens } from '../../theme/tokens';

type BlankResult = {
  status: 'correct' | 'revealed';
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

function renderMaskedSentence(exercise: QuestionFormationExercise, results: Record<string, BlankResult>) {
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
        if (result) {
          return (
            <Text key={piece.blank.id} style={result.status === 'correct' ? styles.correctAnswer : styles.revealedAnswer}>
              {piece.text}
            </Text>
          );
        }

        return <Text key={piece.blank.id} style={styles.blankText}>{`__(${piece.blank.index})__`}</Text>;
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
  const [showFullSentence, setShowFullSentence] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, BlankResult>>({});
  const [feedbackByBlank, setFeedbackByBlank] = useState<Record<string, string>>({});
  const [hintsByBlank, setHintsByBlank] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const activeBlankRef = useRef('');
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sentenceLabel = getNestedString(ui, ['labels', 'questionFormationSentence']);
  const questionLabelTemplate = getNestedString(ui, ['labels', 'questionFormationQuestionLabel']);
  const revealDelayMs = Math.max(0, getNestedNumber(practiceConfig, ['questionFormationRevealDelayMs'], 3000));
  const revealDelaySeconds = String(Math.round(revealDelayMs / 1000));
  const fullSentenceHint = formatTemplate(getNestedString(ui, ['feedback', 'questionFormationFullSentenceHint']), {
    seconds: revealDelaySeconds,
  });
  const loadingText = getNestedString(ui, ['feedback', 'questionFormationLoading']);
  const allDoneText = getNestedString(ui, ['feedback', 'questionFormationAllDone']);
  const hintFeedbackTemplate = getNestedString(ui, ['feedback', 'questionFormationHintUsed']);
  const incorrectFeedbackTemplate = getNestedString(ui, ['feedback', 'questionFormationIncorrectReveal']);
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
    setShowFullSentence(true);
    clearTimeout(revealTimerRef.current || undefined);
    clearTimeout(advanceTimerRef.current || undefined);

    try {
      const nextExercise = await apiClient.generateQuestionFormation(section?.summary || section?.title || '', nextOffset);
      setExercise(nextExercise);
      setOffset(nextOffset);
      revealTimerRef.current = setTimeout(() => {
        setShowFullSentence(false);
      }, revealDelayMs);
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
      clearTimeout(revealTimerRef.current || undefined);
      clearTimeout(advanceTimerRef.current || undefined);
    };
  }, [section?.id, block.id]);

  useEffect(() => {
    if (!exercise?.blanks.length) {
      return;
    }

    const completed = exercise.blanks.every((blank) => Boolean(results[getBlankKey(blank)]));
    if (!completed) {
      return;
    }

    clearTimeout(advanceTimerRef.current || undefined);
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
            status: 'revealed',
            feedback: result.feedback,
          },
        };
      });

      setFeedbackByBlank((current) => ({
        ...current,
        [blankId]: result.accepted
          ? result.feedback
          : String(drafts[blankId] || '').trim()
            ? `${result.feedback} ${formatTemplate(incorrectFeedbackTemplate, { answer: blank.answer })}`.trim()
            : result.feedback,
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

  const completedCount = exercise?.blanks.filter((blank) => Boolean(results[getBlankKey(blank)])).length || 0;
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
            <Text style={styles.label}>{sentenceLabel}</Text>
            {showFullSentence ? <Text style={styles.sentenceText}>{exercise.sentence}</Text> : renderMaskedSentence(exercise, results)}
            {showFullSentence ? <Text style={styles.mutedText}>{fullSentenceHint}</Text> : null}
          </View>

          {!showFullSentence ? (
            <View style={styles.questionList}>
              {exercise.blanks.map((blank) => {
                const blankId = getBlankKey(blank);
                const result = results[blankId];
                const hint = hintsByBlank[blankId];
                const disabled = Boolean(result) || recording || transcribing;

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
                      style={[styles.input, result ? styles.inputDisabled : null]}
                      multiline
                      editable={!result}
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
                        style={[styles.button, result ? styles.buttonDisabled : null]}
                        onPress={() => handleShowHint(blank)}
                        disabled={Boolean(result)}
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
                      <View style={[styles.feedbackCard, result?.status === 'correct' ? styles.feedbackCardSuccess : result?.status === 'revealed' ? styles.feedbackCardWarning : null]}>
                        <Text style={[styles.feedbackText, result?.status === 'correct' ? styles.feedbackTextSuccess : result?.status === 'revealed' ? styles.feedbackTextWarning : null]}>
                          {feedbackByBlank[blankId]}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

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
  sentenceText: {
    color: tokens.colors.ink,
    fontSize: 28,
    lineHeight: 38,
    fontWeight: '800',
  },
  blankText: {
    color: tokens.colors.accentDeep,
    fontWeight: '900',
  },
  correctAnswer: {
    color: '#23824a',
    fontWeight: '900',
  },
  revealedAnswer: {
    color: tokens.colors.danger,
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
