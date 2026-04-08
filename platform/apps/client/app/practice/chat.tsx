import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CoachChatSession } from '@softskills/domain';
import { Screen } from '../../src/components/Screen';
import { useContent } from '../../src/hooks/useContent';
import { useSpeechDraft } from '../../src/hooks/useSpeechDraft';
import { apiClient } from '../../src/lib/api';
import {
  findFirstBlockByRenderer,
  getNestedRecord,
  getNestedString,
  getPracticeConfig,
  getPracticeScreenConfig,
  getSectionByRoute,
  getUiConfig,
} from '../../src/lib/contentMeta';
import { tokens } from '../../src/theme/tokens';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function CapabilityPill({ title, status }: { title: string; status: string }) {
  return (
    <View style={styles.capabilityPill}>
      <Text style={styles.capabilityTitle}>{title}</Text>
      <Text style={styles.capabilityStatus}>{status}</Text>
    </View>
  );
}

export default function CoachChatPracticeScreen() {
  const { content, error } = useContent();
  const ui = getUiConfig(content);
  const practice = getPracticeConfig(content);
  const learningChatConfig = getNestedRecord(practice, ['learningChat']);
  const practiceConfig = getPracticeScreenConfig(content, 'coachChat');
  const sectionRoute = getNestedString(practiceConfig, ['sectionRoute']);
  const blockRenderer = getNestedString(practiceConfig, ['blockRenderer']);
  const section = getSectionByRoute(content, sectionRoute);
  const practiceBlock = findFirstBlockByRenderer(content, section, blockRenderer);
  const scenarios = asRecord(learningChatConfig.scenarios);
  const scenarioOrder = asStringArray(learningChatConfig.scenarioOrder);
  const fallbackScenario = asString(learningChatConfig.defaultScenario, scenarioOrder[0] || Object.keys(scenarios)[0] || 'meeting');
  const [scenario, setScenario] = useState('');
  const [context, setContext] = useState('');
  const [goal, setGoal] = useState('');
  const [draft, setDraft] = useState('');
  const [session, setSession] = useState<CoachChatSession | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scenario) {
      setScenario(fallbackScenario);
    }
  }, [fallbackScenario, scenario]);

  useEffect(() => {
    const defaultGoal = asString(learningChatConfig.defaultGoal);
    if (!goal && defaultGoal) {
      setGoal(defaultGoal);
    }
  }, [goal, learningChatConfig.defaultGoal]);

  const capabilitySource = session?.capabilities ?? {
    text: asBoolean(asRecord(learningChatConfig.capabilities).text, true),
    speechToText: asBoolean(asRecord(learningChatConfig.capabilities).speechToText, false),
    textToSpeech: asBoolean(asRecord(learningChatConfig.capabilities).textToSpeech, false),
  };

  const scenarioKeys = scenarioOrder.length ? scenarioOrder.filter((key) => scenarios[key]) : Object.keys(scenarios);
  const activeScenario = asRecord(scenarios[session?.scenario || scenario || fallbackScenario]);
  const currentSuggestions = session?.suggestions ?? asStringArray(activeScenario.starterSuggestions);
  const userTurns = session?.messages.filter((item) => item.role === 'user').length ?? 0;
  const activeMessageLimit = session?.messageLimit ?? Number(learningChatConfig.messageLimit || 0);

  const coachScenarioLabel = getNestedString(ui, ['labels', 'coachScenario']);
  const coachGoalLabel = getNestedString(ui, ['labels', 'coachGoal']);
  const coachContextLabel = getNestedString(ui, ['labels', 'coachContext']);
  const coachConversationLabel = getNestedString(ui, ['labels', 'coachConversation']);
  const coachFeedbackLabel = getNestedString(ui, ['labels', 'coachFeedback']);
  const coachSuggestionsLabel = getNestedString(ui, ['labels', 'coachSuggestions']);
  const coachCapabilitiesLabel = getNestedString(ui, ['labels', 'coachCapabilities']);
  const coachTranscriptModeLabel = getNestedString(ui, ['labels', 'coachTranscriptMode']);
  const coachMessageLimitLabel = getNestedString(ui, ['labels', 'coachMessageLimit']);
  const coachTextCapabilityLabel = getNestedString(ui, ['labels', 'coachTextCapability']);
  const coachSpeechCapabilityLabel = getNestedString(ui, ['labels', 'coachSpeechToTextCapability']);
  const coachVoiceCapabilityLabel = getNestedString(ui, ['labels', 'coachTextToSpeechCapability']);
  const coachAvailableNowLabel = getNestedString(ui, ['labels', 'coachAvailableNow']);
  const coachPlannedLabel = getNestedString(ui, ['labels', 'coachPlanned']);
  const coachLearnerRoleLabel = getNestedString(ui, ['labels', 'coachLearnerRole']);
  const coachAssistantRoleLabel = getNestedString(ui, ['labels', 'coachAssistantRole']);
  const startCoachChatLabel = getNestedString(ui, ['buttons', 'startCoachChat']);
  const sendCoachReplyLabel = getNestedString(ui, ['buttons', 'sendCoachReply']);
  const restartCoachChatLabel = getNestedString(ui, ['buttons', 'restartCoachChat']);
  const startRecordingLabel = getNestedString(ui, ['buttons', 'startRecording']);
  const stopRecordingLabel = getNestedString(ui, ['buttons', 'stopRecording']);
  const coachChatReadyLabel = getNestedString(ui, ['feedback', 'coachChatReady']);
  const coachChatCompletedLabel = getNestedString(ui, ['feedback', 'coachChatCompleted']);
  const coachChatFallbackLabel = getNestedString(ui, ['feedback', 'coachChatFallback']);
  const coachChatEmptyLabel = getNestedString(ui, ['feedback', 'coachChatEmpty']);
  const recordingUnavailableText = getNestedString(ui, ['feedback', 'speechRecordingUnavailable']);
  const transcribingText = getNestedString(ui, ['feedback', 'speechTranscribing']);
  const emptyTranscriptText = getNestedString(ui, ['feedback', 'speechTranscriptEmpty']);
  const transcriptModeTextLabel = asString(learningChatConfig.transcriptModeTextLabel);
  const providerFallbackNotice = asString(learningChatConfig.providerFallbackNotice, coachChatFallbackLabel);

  const {
    recording,
    transcribing,
    speechStatus,
    startRecording,
    stopRecording,
    clearSpeechStatus,
  } = useSpeechDraft({
    scope: 'coach-chat',
    unsupportedMessage: recordingUnavailableText,
    emptyTranscriptMessage: emptyTranscriptText,
    onTranscript: (text) => {
      setDraft(text);
      setErrorMessage('');
    },
    getLogDetails: () => ({
      sectionId: section?.id || '',
      blockId: practiceBlock?.id || '',
      sessionId: session?.sessionId || '',
      scenario: session?.scenario || scenario || fallbackScenario,
    }),
  });

  async function handleStart() {
    setBusy(true);
    setErrorMessage('');
    setDraft('');
    clearSpeechStatus();
    try {
      const nextSession = await apiClient.startCoachChat(context, goal, scenario || fallbackScenario);
      setSession(nextSession);
    } catch (nextError) {
      setErrorMessage(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (!session || !draft.trim()) {
      return;
    }

    setBusy(true);
    setErrorMessage('');
    try {
      const nextSession = await apiClient.continueCoachChat(session.sessionId, draft.trim());
      setSession(nextSession);
      setDraft('');
      clearSpeechStatus();
    } catch (nextError) {
      setErrorMessage(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

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
        <Text style={styles.cardTitle}>{coachCapabilitiesLabel}</Text>
        <View style={styles.capabilityRow}>
          <CapabilityPill title={coachTextCapabilityLabel} status={capabilitySource.text ? coachAvailableNowLabel : coachPlannedLabel} />
          <CapabilityPill title={coachSpeechCapabilityLabel} status={capabilitySource.speechToText ? coachAvailableNowLabel : coachPlannedLabel} />
          <CapabilityPill title={coachVoiceCapabilityLabel} status={capabilitySource.textToSpeech ? coachAvailableNowLabel : coachPlannedLabel} />
        </View>
        <Text style={styles.metaLine}>{coachTranscriptModeLabel}: {transcriptModeTextLabel}</Text>
        <Text style={styles.metaLine}>{coachMessageLimitLabel}: {activeMessageLimit}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{coachScenarioLabel}</Text>
        <View style={styles.chipRow}>
          {scenarioKeys.map((key) => {
            const scenarioConfig = asRecord(scenarios[key]);
            const label = asString(scenarioConfig.label, key);
            const isActive = (session?.scenario || scenario) === key;
            return (
              <Pressable key={key} style={[styles.chip, isActive ? styles.chipActive : null]} onPress={() => setScenario(key)}>
                <Text style={[styles.chipText, isActive ? styles.chipTextActive : null]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>{coachContextLabel}</Text>
        <TextInput
          value={context}
          onChangeText={setContext}
          placeholder={getNestedString(ui, ['placeholders', 'coachChatContext'])}
          style={[styles.input, styles.inputLarge]}
          multiline
        />

        <Text style={styles.fieldLabel}>{coachGoalLabel}</Text>
        <TextInput
          value={goal}
          onChangeText={setGoal}
          placeholder={getNestedString(ui, ['placeholders', 'coachChatGoal'])}
          style={styles.input}
          multiline
        />

        <Pressable style={[styles.primaryButton, busy ? styles.buttonDisabled : null]} onPress={handleStart} disabled={busy}>
          <Text style={styles.primaryButtonText}>{startCoachChatLabel}</Text>
        </Pressable>
        <Text style={styles.helperText}>{coachChatReadyLabel}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{coachConversationLabel}</Text>
        {session ? (
          <View style={styles.messageStack}>
            {session.messages.map((item) => (
              <View key={item.id} style={[styles.messageBubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                <Text style={[styles.messageRole, item.role === 'user' ? styles.userRole : styles.assistantRole]}>{item.role === 'user' ? coachLearnerRoleLabel : coachAssistantRoleLabel}</Text>
                <Text style={styles.messageText}>{item.text}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.helperText}>{coachChatEmptyLabel}</Text>
        )}
      </View>

      {session ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{coachFeedbackLabel}</Text>
          <Text style={styles.feedbackText}>{session.feedback}</Text>
          {session.providerError ? <Text style={styles.noticeText}>{providerFallbackNotice}</Text> : null}
          {session.completed ? <Text style={styles.noticeText}>{coachChatCompletedLabel}</Text> : null}
        </View>
      ) : null}

      {session ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{coachSuggestionsLabel}</Text>
          <View style={styles.chipRow}>
            {currentSuggestions.map((suggestion) => (
              <Pressable key={suggestion} style={styles.chip} onPress={() => setDraft(suggestion)}>
                <Text style={styles.chipText}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>

          {!session.completed ? (
            <>
              <View style={styles.actionsRow}>
                <Pressable style={[styles.primaryButton, recording || transcribing ? styles.buttonDisabled : null]} onPress={() => void startRecording()} disabled={recording || transcribing || busy}>
                  <Text style={styles.primaryButtonText}>{startRecordingLabel}</Text>
                </Pressable>
                <Pressable style={[styles.secondaryButton, !recording ? styles.buttonDisabled : null]} onPress={stopRecording} disabled={!recording}>
                  <Text style={styles.secondaryButtonText}>{stopRecordingLabel}</Text>
                </Pressable>
              </View>

              {transcribing ? <Text style={styles.noticeText}>{transcribingText}</Text> : null}
              {speechStatus ? <Text style={styles.noticeText}>{speechStatus}</Text> : null}

              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={getNestedString(ui, ['placeholders', 'coachChatReply'])}
                style={[styles.input, styles.inputLarge]}
                multiline
              />
              <Pressable style={[styles.secondaryButton, busy ? styles.buttonDisabled : null]} onPress={handleSend} disabled={busy}>
                <Text style={styles.secondaryButtonText}>{sendCoachReplyLabel}</Text>
              </Pressable>
            </>
          ) : null}

          <Pressable style={styles.ghostButton} onPress={() => { setSession(null); setDraft(''); setErrorMessage(''); clearSpeechStatus(); }}>
            <Text style={styles.ghostButtonText}>{restartCoachChatLabel}</Text>
          </Pressable>
          <Text style={styles.helperText}>{coachMessageLimitLabel}: {userTurns}/{activeMessageLimit}</Text>
        </View>
      ) : null}

      {error || errorMessage ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{errorMessage || error}</Text>
        </View>
      ) : null}
    </Screen>
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
  cardTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  capabilityPill: {
    minWidth: 170,
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: 4,
  },
  capabilityTitle: {
    color: tokens.colors.ink,
    fontWeight: '800',
  },
  capabilityStatus: {
    color: tokens.colors.accentDeep,
    fontWeight: '700',
  },
  metaLine: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  fieldLabel: {
    color: tokens.colors.ink,
    fontWeight: '800',
    marginBottom: -6,
  },
  input: {
    backgroundColor: tokens.colors.surface,
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
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  primaryButton: {
    backgroundColor: tokens.colors.accent,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: tokens.colors.accentContrast,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  secondaryButtonText: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  ghostButton: {
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  ghostButtonText: {
    color: tokens.colors.ink,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  helperText: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  chip: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  chipActive: {
    backgroundColor: '#fce1cc',
  },
  chipText: {
    color: tokens.colors.ink,
    fontWeight: '700',
  },
  chipTextActive: {
    color: tokens.colors.accentDeep,
  },
  messageStack: {
    gap: tokens.spacing.sm,
  },
  messageBubble: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    gap: 6,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  assistantBubble: {
    backgroundColor: tokens.colors.surface,
    alignSelf: 'stretch',
  },
  userBubble: {
    backgroundColor: '#f8ead8',
    alignSelf: 'stretch',
  },
  messageRole: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  assistantRole: {
    color: tokens.colors.accentDeep,
  },
  userRole: {
    color: tokens.colors.ink,
  },
  messageText: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  feedbackText: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  noticeText: {
    color: tokens.colors.accentDeep,
    lineHeight: 22,
  },
  errorCard: {
    backgroundColor: '#fff1ed',
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: '#f2c5b5',
  },
  errorText: {
    color: tokens.colors.danger,
    lineHeight: 22,
  },
});
