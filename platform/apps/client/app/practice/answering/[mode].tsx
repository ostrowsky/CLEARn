import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AnsweringMode, AnsweringQuestionTurn, AnsweringReactionCategory, AnsweringReactionOption, AnsweringSession, AnsweringSessionMode } from '@softskills/domain';
import { Screen } from '../../../src/components/Screen';
import { useContent } from '../../../src/hooks/useContent';
import { apiClient } from '../../../src/lib/api';
import {
  fillRuntimeTemplate,
  findFirstBlockByRenderer,
  getNestedString,
  getPracticeScreenConfig,
  getSectionByRoute,
  getUiConfig,
} from '../../../src/lib/contentMeta';
import {
  MAX_RECORDING_MS,
  getPreferredRecorderMimeType,
  getSpeechRecognitionConstructor,
  normalizeMimeType,
  prepareSpeechPayloadForStt,
  supportsBrowserRecording,
  supportsDirectSttMimeType,
} from '../../../src/lib/webSpeech';
import { tokens } from '../../../src/theme/tokens';

function averageToLabel(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function formatTranscriptSourceLabel(source: 'text' | 'speech' | undefined) {
  return source === 'speech' ? 'Speech draft' : 'Text draft';
}

const ANSWERING_REACTION_TYPES: AnsweringMode[] = ['good', 'difficult', 'unnecessary', 'irrelevant'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeReactionText(value: string) {
  return String(value || '').trim().toLowerCase();
}

function defaultReactionCategoryLabel(type: AnsweringMode) {
  switch (type) {
    case 'good':
      return "It's a good question";
    case 'difficult':
      return "It's a difficult question";
    case 'unnecessary':
      return "It's an unnecessary question";
    case 'irrelevant':
      return "It's an irrelevant question";
    default:
      return 'Choose a reaction';
  }
}

function toConfiguredReactionOptions(value: unknown, categoryType: AnsweringMode): AnsweringReactionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      const id = asString(record.id);
      const text = asString(record.text);
      return id && text ? { id, text, categoryType } : null;
    })
    .filter((item): item is AnsweringReactionOption => Boolean(item));
}

function getResolvedReactionCategories(content: unknown, turn: AnsweringQuestionTurn | null | undefined): AnsweringReactionCategory[] {
  if (!turn) {
    return [];
  }

  if (Array.isArray(turn.reactionCategories) && turn.reactionCategories.length) {
    return turn.reactionCategories;
  }

  const questionTypes = asRecord(asRecord(asRecord(asRecord(content).meta).practice).answeringSession).questionTypes;
  const flatOptions = Array.isArray(turn.reactionOptions) ? turn.reactionOptions : [];

  return ANSWERING_REACTION_TYPES.map((type, index) => {
    const typeConfig = asRecord(asRecord(questionTypes)[type]);
    const configuredOptions = toConfiguredReactionOptions(typeConfig.reactionOptions, type);
    const matchedOptions = flatOptions
      .filter((option) => {
        if (option.categoryType === type) {
          return true;
        }

        if (configuredOptions.some((configured) => configured.id === option.id || normalizeReactionText(configured.text) === normalizeReactionText(option.text))) {
          return true;
        }

        return !option.categoryType && flatOptions.length === ANSWERING_REACTION_TYPES.length && flatOptions[index]?.id === option.id;
      })
      .map((option) => ({ ...option, categoryType: option.categoryType || type }));

    return {
      type,
      label: asString(typeConfig.selectorLabel, defaultReactionCategoryLabel(type)),
      options: matchedOptions.length ? matchedOptions : configuredOptions,
    };
  }).filter((category) => category.options.length > 0);
}

export default function AnsweringPracticeScreen() {
  const { mode, sectionId, blockId } = useLocalSearchParams<{ mode?: AnsweringSessionMode; sectionId?: string; blockId?: string }>();
  const resolvedMode: AnsweringSessionMode = mode === 'good' || mode === 'difficult' || mode === 'unnecessary' || mode === 'irrelevant' || mode === 'mixed'
    ? mode
    : 'mixed';
  const { content, error } = useContent();
  const ui = getUiConfig(content);
  const practiceConfig = getPracticeScreenConfig(content, 'answering');
  const values = { mode: resolvedMode };
  const sectionRoute = getNestedString(practiceConfig, ['sectionRoute']) || fillRuntimeTemplate(getNestedString(practiceConfig, ['sectionRouteTemplate']), values);
  const blockRenderer = getNestedString(practiceConfig, ['blockRenderer']);
  const section = sectionId
    ? (content?.sections.find((item) => item.id === sectionId) || null)
    : (getSectionByRoute(content, sectionRoute) || null);
  const practiceBlock = blockId
    ? (section?.blocks.find((block) => block.id === blockId) || findFirstBlockByRenderer(content, section || undefined, blockRenderer))
    : findFirstBlockByRenderer(content, section || undefined, blockRenderer);

  const [context, setContext] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');
  const [selectedReactionId, setSelectedReactionId] = useState('');
  const [selectedReactionCategory, setSelectedReactionCategory] = useState<AnsweringMode | ''>('');
  const [answerSource, setAnswerSource] = useState<'text' | 'speech'>('text');
  const [session, setSession] = useState<AnsweringSession | null>(null);
  const [screenError, setScreenError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speechRecognitionConstructor = getSpeechRecognitionConstructor();
  const speechRecognitionSupported = Boolean(speechRecognitionConstructor);
  const mediaRecorderSupported = supportsBrowserRecording();
  const preferredRecorderMimeType = getPreferredRecorderMimeType();
  const mediaRecorderSttCompatible = !preferredRecorderMimeType || supportsDirectSttMimeType(preferredRecorderMimeType);
  const shouldPreferSpeechRecognition = speechRecognitionSupported && mediaRecorderSupported && !mediaRecorderSttCompatible;
  const recordingSupported = mediaRecorderSupported || speechRecognitionSupported;

  const describeYourRole = getNestedString(ui, ['labels', 'describeYourRole']);
  const yourAnswerLabel = getNestedString(ui, ['labels', 'yourAnswer']);
  const chooseReactionLabel = getNestedString(ui, ['labels', 'chooseReaction']);
  const reactionDropdownHintLabel = getNestedString(ui, ['labels', 'reactionDropdownHint'], 'Select opening phrase');
  const politenessScoreLabel = getNestedString(ui, ['labels', 'politenessScore']);
  const grammarScoreLabel = getNestedString(ui, ['labels', 'grammarScore']);
  const improvedAnswerLabel = getNestedString(ui, ['labels', 'improvedAnswer']);
  const grammarFixesLabel = getNestedString(ui, ['labels', 'grammarFixes']);
  const toneFixesLabel = getNestedString(ui, ['labels', 'toneFixes']);
  const sessionSummaryLabel = getNestedString(ui, ['labels', 'sessionSummary']);
  const strongestQuestionTypeLabel = getNestedString(ui, ['labels', 'strongestQuestionType']);
  const focusQuestionTypeLabel = getNestedString(ui, ['labels', 'focusQuestionType']);
  const improvementTipsLabel = getNestedString(ui, ['labels', 'improvementTips']);
  const questionProgressLabel = getNestedString(ui, ['labels', 'questionProgress']);
  const startDialogueLabel = getNestedString(ui, ['buttons', 'startDialogue']);
  const sendAnswerLabel = getNestedString(ui, ['buttons', 'sendAnswer']);
  const startOverLabel = getNestedString(ui, ['buttons', 'startOver']);
  const startRecordingLabel = getNestedString(ui, ['buttons', 'startRecording']);
  const stopRecordingLabel = getNestedString(ui, ['buttons', 'stopRecording']);
  const recordingUnavailableText = getNestedString(ui, ['feedback', 'speechRecordingUnavailable']);
  const transcribingText = getNestedString(ui, ['feedback', 'speechTranscribing']);
  const emptyTranscriptText = getNestedString(ui, ['feedback', 'speechTranscriptEmpty']);
  const completedFeedback = getNestedString(ui, ['feedback', 'answeringSessionComplete']);
  const contextPlaceholder = getNestedString(ui, ['placeholders', 'answeringContext']);
  const answerPlaceholder = getNestedString(ui, ['placeholders', 'answeringReply']);
  const conversationHistoryLabel = getNestedString(ui, ['labels', 'conversationHistory'], 'Conversation history');
  const coachFeedbackLabel = getNestedString(ui, ['labels', 'coachFeedback'], 'Coach feedback');
  const yourReactionLabel = getNestedString(ui, ['labels', 'yourReaction'], 'Your reaction');
  const yourReplyLabel = getNestedString(ui, ['labels', 'yourReply'], 'Your reply');
  const currentQuestionLabel = getNestedString(ui, ['labels', 'currentQuestion'], 'Current question');
  const answerComposerLabel = getNestedString(ui, ['labels', 'answerComposer'], 'Write your next reply');

  function logAction(event: string, details: Record<string, unknown> = {}) {
    void apiClient.logDebug('answering', event, {
      sectionId: section?.id || '',
      blockId: practiceBlock?.id || '',
      mode: resolvedMode,
      platform: Platform.OS,
      ...details,
    });
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function scheduleRecordingStop(onTimeout: () => void) {
    clearRecordingTimer();
    recordingTimerRef.current = setTimeout(() => {
      recordingTimerRef.current = null;
      onTimeout();
    }, MAX_RECORDING_MS);
  }

  function stopActiveStream() {
    if (!streamRef.current) {
      return;
    }

    for (const track of streamRef.current.getTracks()) {
      track.stop();
    }
    streamRef.current = null;
  }

  function handleAnswerDraftChange(text: string) {
    setAnswerDraft(text);
  }

  function handleSelectReactionCategory(type: AnsweringMode) {
    setScreenError('');
    setSelectedReactionId('');
    setSelectedReactionCategory((current) => (current === type ? '' : type));
  }

  function handleSelectReactionOption(type: AnsweringMode, optionId: string) {
    setScreenError('');
    setSelectedReactionCategory(type);
    setSelectedReactionId(optionId);
  }

  useEffect(() => () => {
    clearRecordingTimer();
    const recognition = recognitionRef.current as any;
    if (recognition?.abort) {
      recognition.abort();
    }
    recognitionRef.current = null;

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recorderRef.current = null;
    stopActiveStream();
  }, []);

  async function handleStartSession() {
    setBusy(true);
    setScreenError('');
    try {
      const nextSession = await apiClient.startAnswering(context, resolvedMode);
      setSession(nextSession);
      setAnswerDraft('');
      setSelectedReactionId('');
      setAnswerSource('text');
      setSpeechStatus('');
      logAction('session:start', { contextLength: context.length });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setScreenError(message);
      logAction('session:start-error', { message });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitAnswer() {
    if (!session?.currentTurn) {
      return;
    }

    if (!selectedReactionId) {
      setScreenError('Choose the most appropriate reaction phrase before you submit the answer.');
      return;
    }

    setBusy(true);
    setScreenError('');
    try {
      const nextSession = await apiClient.respondAnswering(session.sessionId, selectedReactionId, answerDraft, answerSource);
      setSession(nextSession);
      setAnswerDraft('');
      setSelectedReactionId('');
      setAnswerSource('text');
      setSpeechStatus('');
      logAction('turn:submit', { source: answerSource, turnId: session.currentTurn.turnId });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setScreenError(message);
      logAction('turn:submit-error', { message });
    } finally {
      setBusy(false);
    }
  }

  async function handleRestartSession() {
    setSession(null);
    setAnswerDraft('');
    setSelectedReactionId('');
    setAnswerSource('text');
    setSpeechStatus('');
    setScreenError('');
    await handleStartSession();
  }

  async function handleStartRecording() {
    if (!recordingSupported) {
      setSpeechStatus(recordingUnavailableText);
      return;
    }

    if (mediaRecorderSupported && !shouldPreferSpeechRecognition) {
      try {
        const mediaDevices = (globalThis as typeof globalThis & { navigator?: Navigator }).navigator?.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
          throw new Error(recordingUnavailableText);
        }

        const mediaStream = await mediaDevices.getUserMedia({ audio: true });
        const recorder = preferredRecorderMimeType ? new MediaRecorder(mediaStream, { mimeType: preferredRecorderMimeType }) : new MediaRecorder(mediaStream);
        chunksRef.current = [];
        streamRef.current = mediaStream;
        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };
        recorder.onstop = async () => {
          clearRecordingTimer();
          setRecording(false);
          setTranscribing(true);
          try {
            const mimeType = normalizeMimeType(recorder.mimeType || preferredRecorderMimeType || 'audio/webm');
            const blob = new Blob(chunksRef.current, { type: mimeType });
            if (!blob.size) {
              setSpeechStatus(emptyTranscriptText);
              return;
            }

            const payload = await prepareSpeechPayloadForStt(blob, mimeType);
            const result = await apiClient.speechToText(payload.audioBase64, payload.mimeType);
            const transcript = String(result.text || '').trim();
            if (!transcript) {
              setSpeechStatus(emptyTranscriptText);
              return;
            }

            setAnswerDraft(transcript);
            setAnswerSource('speech');
            setSpeechStatus('');
          } catch (nextError) {
            setSpeechStatus(nextError instanceof Error ? nextError.message : String(nextError));
          } finally {
            chunksRef.current = [];
            recorderRef.current = null;
            stopActiveStream();
            setTranscribing(false);
          }
        };
        recorder.onerror = () => {
          setSpeechStatus(recordingUnavailableText);
          setRecording(false);
          setTranscribing(false);
          clearRecordingTimer();
          recorderRef.current = null;
          chunksRef.current = [];
          stopActiveStream();
        };
        recorder.start();
        setSpeechStatus('');
        setRecording(true);
        scheduleRecordingStop(() => {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        });
        return;
      } catch (nextError) {
        if (!speechRecognitionConstructor) {
          setSpeechStatus(nextError instanceof Error ? nextError.message : String(nextError));
          return;
        }
      }
    }

    if (speechRecognitionConstructor) {
      try {
        const Recognition = speechRecognitionConstructor as any;
        const recognition = new Recognition();
        recognition.lang = 'en-US';
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognitionRef.current = recognition;
        setSpeechStatus('');
        setRecording(true);
        recognition.onresult = (event: any) => {
          const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
          if (!transcript) {
            setSpeechStatus(emptyTranscriptText);
            return;
          }
          setAnswerDraft(transcript);
          setAnswerSource('speech');
          setSpeechStatus('');
        };
        recognition.onerror = (event: any) => {
          const reason = String(event?.error || event?.message || '').trim();
          setSpeechStatus(reason ? `Speech recognition error: ${reason}` : recordingUnavailableText);
        };
        recognition.onend = () => {
          clearRecordingTimer();
          setRecording(false);
          setTranscribing(false);
          recognitionRef.current = null;
        };
        recognition.start();
        scheduleRecordingStop(() => recognition.stop());
      } catch (nextError) {
        setSpeechStatus(nextError instanceof Error ? nextError.message : String(nextError));
        setRecording(false);
        setTranscribing(false);
        clearRecordingTimer();
      }
    }
  }

  function handleStopRecording() {
    clearRecordingTimer();
    const recognition = recognitionRef.current as any;
    if (recognition) {
      setTranscribing(true);
      recognition.stop();
      return;
    }

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  const currentTurn = session?.currentTurn || null;
  const resolvedReactionCategories = getResolvedReactionCategories(content, currentTurn);
  const currentProgress = session ? session.turns.length + (session.completed ? 0 : 1) : 0;

  useEffect(() => {
    setSelectedReactionId('');
    setSelectedReactionCategory('');
    setAnswerDraft('');
    setAnswerSource('text');
    setSpeechStatus('');
  }, [session?.currentTurn?.turnId]);

  return (
    <Screen
      appTitle={content?.meta.appTitle}
      brandTagline={getNestedString(ui, ['brandTagline'])}
      footerNote={getNestedString(ui, ['footerNote'])}
      eyebrow={section?.eyebrow}
      title={practiceBlock?.title ?? section?.title ?? ''}
      subtitle={practiceBlock?.description ?? section?.summary ?? ''}
      backHref={section ? `/section/${section.id}` : '/sections'}
      backLabel={section?.title ?? getNestedString(ui, ['navigation', 'backToHome'])}
    >
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>{describeYourRole}</Text>
        <TextInput value={context} onChangeText={setContext} placeholder={contextPlaceholder} style={[styles.input, styles.inputLarge]} multiline />
        <View style={styles.inlineActions}>
          <Pressable style={[styles.button, busy ? styles.buttonDisabled : null]} onPress={() => void handleStartSession()} disabled={busy}>
            <Text style={styles.buttonText}>{startDialogueLabel}</Text>
          </Pressable>
          {session ? (
            <Pressable style={styles.secondaryButton} onPress={() => void handleRestartSession()}>
              <Text style={styles.secondaryText}>{startOverLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {screenError ? <View style={styles.feedbackCard}><Text style={styles.feedbackText}>{screenError}</Text></View> : null}

      {session ? (
        <View style={styles.chatCard}>
          <View style={styles.progressRow}>
            <Text style={styles.resultTitle}>{conversationHistoryLabel}</Text>
            <Text style={styles.progressText}>{questionProgressLabel}: {currentProgress}/{session.totalQuestions}</Text>
          </View>

          {session.turns.map((turn) => (
            <View key={turn.turnId} style={styles.turnGroup}>
              <View style={[styles.messageBubble, styles.assistantBubble]}>
                <View style={styles.chatMetaRow}>
                  <Text style={styles.chatMetaTag}>Question {turn.index}</Text>
                </View>
                <Text style={styles.chatText}>{turn.questionText}</Text>
              </View>

              <View style={[styles.messageBubble, styles.userBubble]}>
                <View style={styles.chatMetaRow}>
                  <Text style={styles.chatHeading}>{yourReplyLabel}</Text>
                  <Text style={styles.chatMetaTag}>{formatTranscriptSourceLabel(turn.transcriptSource)}</Text>
                </View>
                <View style={styles.inlinePanel}>
                  <Text style={styles.resultLabel}>{yourReactionLabel}</Text>
                  <Text style={styles.resultText}>{turn.chosenReactionText || '-'}</Text>
                </View>
                <Text style={styles.chatText}>{turn.answerText || '-'}</Text>
              </View>

              {turn.evaluation ? (
                <View style={[styles.messageBubble, styles.coachBubble]}>
                  <Text style={styles.chatHeading}>{coachFeedbackLabel}</Text>
                  <View style={styles.scoreRow}>
                    <View style={styles.scoreCard}><Text style={styles.scoreLabel}>{politenessScoreLabel}</Text><Text style={styles.scoreValue}>{turn.evaluation.politenessScore}/5</Text></View>
                    <View style={styles.scoreCard}><Text style={styles.scoreLabel}>{grammarScoreLabel}</Text><Text style={styles.scoreValue}>{turn.evaluation.grammarScore}/5</Text></View>
                  </View>
                  <Text style={styles.description}>{turn.evaluation.briefFeedback}</Text>
                  <View style={styles.resultPanel}><Text style={styles.resultLabel}>{improvedAnswerLabel}</Text><Text style={styles.resultText}>{turn.evaluation.improvedAnswer}</Text></View>
                  {turn.evaluation.grammarFixes.length ? <View style={styles.resultPanel}><Text style={styles.resultLabel}>{grammarFixesLabel}</Text>{turn.evaluation.grammarFixes.map((item) => <Text key={item} style={styles.bulletText}>- {item}</Text>)}</View> : null}
                  {turn.evaluation.toneFixes.length ? <View style={styles.resultPanel}><Text style={styles.resultLabel}>{toneFixesLabel}</Text>{turn.evaluation.toneFixes.map((item) => <Text key={item} style={styles.bulletText}>- {item}</Text>)}</View> : null}
                </View>
              ) : null}
            </View>
          ))}

          {currentTurn ? (
            <View style={[styles.messageBubble, styles.assistantBubble, styles.currentQuestionBubble]}>
              <View style={styles.chatMetaRow}>
                <Text style={styles.chatMetaTag}>Question {currentTurn.index}</Text>
              </View>
              <Text style={styles.chatHeading}>{currentQuestionLabel}</Text>
              <Text style={styles.chatText}>{currentTurn.questionText}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {session?.completed && session.summary ? (
        <View style={styles.card}>
          <Text style={styles.resultTitle}>{sessionSummaryLabel}</Text>
          {completedFeedback ? <Text style={styles.description}>{completedFeedback}</Text> : null}
          <View style={styles.scoreRow}>
            <View style={styles.scoreCard}><Text style={styles.scoreLabel}>{politenessScoreLabel}</Text><Text style={styles.scoreValue}>{averageToLabel(session.summary.averagePolitenessScore)}/5</Text></View>
            <View style={styles.scoreCard}><Text style={styles.scoreLabel}>{grammarScoreLabel}</Text><Text style={styles.scoreValue}>{averageToLabel(session.summary.averageGrammarScore)}/5</Text></View>
          </View>
          <View style={styles.resultPanel}><Text style={styles.resultLabel}>{strongestQuestionTypeLabel}</Text><Text style={styles.resultText}>{session.summary.strongestQuestionType}</Text></View>
          <View style={styles.resultPanel}><Text style={styles.resultLabel}>{focusQuestionTypeLabel}</Text><Text style={styles.resultText}>{session.summary.focusQuestionType}</Text></View>
          {session.summary.improvementTips.length ? <View style={styles.resultPanel}><Text style={styles.resultLabel}>{improvementTipsLabel}</Text>{session.summary.improvementTips.map((item) => <Text key={item} style={styles.bulletText}>- {item}</Text>)}</View> : null}
        </View>
      ) : null}

      {currentTurn ? (
        <View style={styles.card}>
          <Text style={styles.resultTitle}>{answerComposerLabel}</Text>
          <Text style={styles.fieldLabel}>{chooseReactionLabel}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reactionCategoryRow}>
            {resolvedReactionCategories.map((category) => {
              const categorySelected = selectedReactionCategory === category.type;
              const hasSelectedOption = category.options.some((option) => option.id === selectedReactionId);
              return (
                <View key={category.type} style={styles.reactionCategoryCard}>
                  <Pressable
                    style={[styles.reactionCategoryButton, categorySelected || hasSelectedOption ? styles.reactionCategoryButtonActive : null]}
                    onPress={() => handleSelectReactionCategory(category.type)}
                  >
                    <View style={styles.reactionCategoryButtonRow}>
                      <Text style={[styles.reactionCategoryButtonText, categorySelected || hasSelectedOption ? styles.reactionCategoryButtonTextActive : null]}>{category.label}</Text>
                      <Text style={[styles.reactionCategoryChevron, categorySelected || hasSelectedOption ? styles.reactionCategoryChevronActive : null]}>{categorySelected ? '^' : 'v'}</Text>
                    </View>
                    <Text style={[styles.reactionCategoryHint, categorySelected || hasSelectedOption ? styles.reactionCategoryHintActive : null]}>{reactionDropdownHintLabel}</Text>
                  </Pressable>
                  {categorySelected ? (
                    <View style={styles.reactionDropdown}>
                      {category.options.map((option) => (
                        <Pressable
                          key={option.id}
                          style={[styles.choiceChip, selectedReactionId === option.id ? styles.choiceChipActive : null]}
                          onPress={() => handleSelectReactionOption(category.type, option.id)}
                        >
                          <Text style={[styles.choiceText, selectedReactionId === option.id ? styles.choiceTextActive : null]}>{option.text}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.inlineActions}>
            <Pressable style={[styles.button, recording || transcribing ? styles.buttonDisabled : null]} onPress={() => void handleStartRecording()} disabled={recording || transcribing}><Text style={styles.buttonText}>{startRecordingLabel}</Text></Pressable>
            <Pressable style={[styles.secondaryButton, !recording ? styles.buttonDisabled : null]} onPress={handleStopRecording} disabled={!recording}><Text style={styles.secondaryText}>{stopRecordingLabel}</Text></Pressable>
          </View>
          {transcribing ? <View style={styles.noticeCard}><Text style={styles.noticeText}>{transcribingText}</Text></View> : null}
          {speechStatus ? <View style={styles.noticeCard}><Text style={styles.noticeText}>{speechStatus}</Text></View> : null}
          <Text style={styles.fieldLabel}>{yourAnswerLabel}</Text>
          <TextInput value={answerDraft} onChangeText={handleAnswerDraftChange} placeholder={answerPlaceholder} style={[styles.input, styles.inputLarge]} multiline />
          <Pressable style={[styles.button, busy ? styles.buttonDisabled : null]} onPress={() => void handleSubmitAnswer()} disabled={busy}><Text style={styles.buttonText}>{sendAnswerLabel}</Text></Pressable>
        </View>
      ) : null}

      {error ? <View style={styles.feedbackCard}><Text style={styles.feedbackText}>{error}</Text></View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: tokens.colors.surface, borderRadius: tokens.radius.lg, padding: tokens.spacing.lg, gap: tokens.spacing.md, borderWidth: 1, borderColor: tokens.colors.cardLine },
  chatCard: { backgroundColor: tokens.colors.surface, borderRadius: tokens.radius.lg, padding: tokens.spacing.lg, gap: tokens.spacing.md, borderWidth: 1, borderColor: tokens.colors.cardLine },
  turnGroup: { gap: tokens.spacing.sm },
  messageBubble: { maxWidth: '92%', borderRadius: tokens.radius.lg, padding: tokens.spacing.md, gap: tokens.spacing.sm, borderWidth: 1, borderColor: tokens.colors.cardLine },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: tokens.colors.surfaceMuted },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#fff8ef' },
  coachBubble: { alignSelf: 'flex-start', backgroundColor: '#fffaf4' },
  currentQuestionBubble: { borderColor: tokens.colors.accent },
  cardEyebrow: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, color: tokens.colors.accentDeep, fontWeight: '800' },
  questionText: { fontSize: 24, lineHeight: 30, fontWeight: '900', color: tokens.colors.ink },
  resultTitle: { fontSize: 22, lineHeight: 28, fontWeight: '900', color: tokens.colors.ink },
  chatHeading: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: tokens.colors.ink },
  chatText: { color: tokens.colors.ink, lineHeight: 24, fontSize: 16 },
  fieldLabel: { color: tokens.colors.ink, fontWeight: '800' },
  input: { backgroundColor: tokens.colors.surfaceMuted, borderRadius: tokens.radius.md, padding: tokens.spacing.md, color: tokens.colors.ink, minHeight: 52, borderWidth: 1, borderColor: tokens.colors.cardLine },
  inputLarge: { minHeight: 110, textAlignVertical: 'top' },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  button: { backgroundColor: tokens.colors.accent, borderRadius: tokens.radius.md, paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  secondaryButton: { backgroundColor: tokens.colors.surfaceMuted, borderRadius: tokens.radius.md, paddingVertical: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: tokens.colors.cardLine },
  secondaryText: { color: tokens.colors.accentDeep, fontWeight: '800', textAlign: 'center' },
  buttonDisabled: { opacity: 0.55 },
  feedbackCard: { borderRadius: tokens.radius.md, padding: tokens.spacing.md, backgroundColor: '#fff1ed', borderWidth: 1, borderColor: '#f2c5b5' },
  feedbackText: { color: tokens.colors.danger, lineHeight: 22 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.sm },
  reactionCategoryRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: tokens.spacing.sm, alignItems: 'flex-start', paddingBottom: 2 },
  reactionCategoryCard: { width: 248, gap: tokens.spacing.xs },
  reactionCategoryButton: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: tokens.radius.md, backgroundColor: tokens.colors.surfaceMuted, borderWidth: 1, borderColor: tokens.colors.cardLine, gap: 6 },
  reactionCategoryButtonActive: { borderColor: tokens.colors.accent, backgroundColor: '#ffe5ca' },
  reactionCategoryButtonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacing.xs },
  reactionCategoryButtonText: { color: tokens.colors.inkSoft, fontWeight: '700' },
  reactionCategoryButtonTextActive: { color: tokens.colors.accentDeep },
  reactionCategoryChevron: { color: tokens.colors.inkSoft, fontWeight: '900' },
  reactionCategoryChevronActive: { color: tokens.colors.accentDeep },
  reactionCategoryHint: { color: tokens.colors.inkSoft, fontSize: 12, lineHeight: 16 },
  reactionCategoryHintActive: { color: tokens.colors.accentDeep },
  reactionDropdown: { gap: tokens.spacing.xs, padding: tokens.spacing.sm, borderRadius: tokens.radius.md, backgroundColor: '#fffaf4', borderWidth: 1, borderColor: tokens.colors.cardLine },
  choiceChip: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: tokens.radius.pill, backgroundColor: tokens.colors.surfaceMuted, borderWidth: 1, borderColor: tokens.colors.cardLine },
  choiceChipActive: { borderColor: tokens.colors.accent, backgroundColor: '#ffe5ca' },
  choiceText: { color: tokens.colors.inkSoft, fontWeight: '700' },
  choiceTextActive: { color: tokens.colors.accentDeep },
  noticeCard: { borderRadius: tokens.radius.md, padding: tokens.spacing.md, backgroundColor: '#fff6ea', borderWidth: 1, borderColor: tokens.colors.cardLine },
  noticeText: { color: tokens.colors.accentDeep, lineHeight: 22 },
  progressRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: tokens.spacing.sm, alignItems: 'center' },
  progressText: { color: tokens.colors.inkSoft, fontWeight: '700' },
  description: { color: tokens.colors.inkSoft, lineHeight: 22 },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.md },
  scoreCard: { minWidth: 140, backgroundColor: tokens.colors.surface, borderRadius: tokens.radius.md, padding: tokens.spacing.md, borderWidth: 1, borderColor: tokens.colors.cardLine, gap: tokens.spacing.xs },
  scoreLabel: { color: tokens.colors.inkSoft, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700' },
  scoreValue: { color: tokens.colors.ink, fontSize: 26, lineHeight: 30, fontWeight: '900' },
  resultPanel: { borderRadius: tokens.radius.md, padding: tokens.spacing.md, backgroundColor: tokens.colors.surfaceMuted, borderWidth: 1, borderColor: tokens.colors.cardLine, gap: tokens.spacing.xs },
  inlinePanel: { borderRadius: tokens.radius.md, padding: tokens.spacing.md, backgroundColor: tokens.colors.surface, borderWidth: 1, borderColor: tokens.colors.cardLine, gap: tokens.spacing.xs },
  resultLabel: { color: tokens.colors.accentDeep, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '800' },
  resultText: { color: tokens.colors.ink, lineHeight: 22, fontWeight: '700' },
  bulletText: { color: tokens.colors.inkSoft, lineHeight: 22 },
  chatMetaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: tokens.spacing.sm, alignItems: 'center' },
  chatMetaTag: { color: tokens.colors.inkSoft, fontSize: 12, lineHeight: 16, fontWeight: '700' },
});













