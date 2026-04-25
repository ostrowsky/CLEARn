import crypto from 'node:crypto';
import type { ChatMessage, CoachChatSession, CoachChatTurn } from '@softskills/domain';
import { env } from '../../config/env';
import { withChatProvider } from '../../providers/providerRegistry';
import { inferConversationContext } from '../shared/contextSummary';
import { looksMeaningfulUserInput } from '../shared/inputValidation';
import type { ContentService } from '../content/content.service';
import type { SessionStore } from './session.store';

type ScenarioConfig = {
  key: string;
  data: Record<string, unknown>;
  label: string;
  starterSuggestions: string[];
  fallbackSuggestions: string[];
};


function message(role: ChatMessage['role'], text: string): ChatMessage {
  return { id: crypto.randomUUID(), role, text, createdAt: new Date().toISOString() };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function normalizeWhitespace(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getNestedRecord(source: Record<string, unknown>, path: string[]) {
  let current: Record<string, unknown> = source;
  for (const segment of path) {
    current = asRecord(current[segment]);
  }
  return current;
}

function getNestedString(source: Record<string, unknown>, path: string[], fallback = ''): string {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return fallback;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' ? current : fallback;
}

function formatTemplate(template: string, values: Record<string, string>) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_match, key) => values[key] ?? '');
}

function summarizeContext(context: string) {
  return inferConversationContext(context, 'the current conversation').subject;
}

function serializeTranscript(messages: ChatMessage[]) {
  return messages.map((item) => `${item.role.toUpperCase()}: ${item.text}`).join('\n');
}

function normalizeScenarioKey(config: Record<string, unknown>, scenario: string) {
  const scenarios = getNestedRecord(config, ['scenarios']);
  const requested = (scenario || '').trim();
  if (requested && scenarios[requested]) {
    return requested;
  }

  const fallback = asString(config.defaultScenario);
  if (fallback && scenarios[fallback]) {
    return fallback;
  }

  return Object.keys(scenarios)[0] || 'meeting';
}

function mapInferredScenarioKey(config: Record<string, unknown>, context: string, goal: string, requestedScenario: string) {
  const scenarios = getNestedRecord(config, ['scenarios']);
  const defaultScenario = asString(config.defaultScenario);
  const requested = normalizeScenarioKey(config, requestedScenario);
  const combined = normalizeWhitespace(`${context} ${goal}`);
  const lower = combined.toLowerCase();
  if (!combined) {
    return requested;
  }

  if (/\b(q&a|qa session|audience questions|follow-up questions)\b/.test(lower) && scenarios.qa) {
    return 'qa';
  }

  const inferred = inferConversationContext(combined, 'the current conversation').scenario;
  const mapped = inferred === 'interview'
    ? 'interview'
    : inferred === 'standup'
      ? 'standup'
      : inferred === 'performance review' || inferred === 'one-to-one'
        ? 'oneToOne'
        : 'meeting';

  if ((!requestedScenario || requested === defaultScenario) && scenarios[mapped]) {
    return mapped;
  }

  return requested;
}

function createTemplateValues(session: Pick<CoachChatSession, 'context' | 'goal'>, scenarioLabel: string, userReply = '') {
  return {
    scenarioLabel,
    goal: session.goal,
    contextSummary: summarizeContext(session.context),
    userReply,
  };
}

function stripLeadingArticle(value: string) {
  return normalizeWhitespace(value).replace(/^(the|a|an)\s+/i, '');
}

function pickContextArea(contextInfo: ReturnType<typeof inferConversationContext>, turnIndex: number) {
  const pool = contextInfo.focusAreas.map((item) => stripLeadingArticle(item)).filter(Boolean);
  if (!pool.length) {
    return stripLeadingArticle(contextInfo.focus || contextInfo.subject || 'the main topic') || 'the main topic';
  }

  return pool[(Math.max(turnIndex, 1) - 1) % pool.length] || pool[0] || 'the main topic';
}

function buildDefaultOpeningQuestion(contextInfo: ReturnType<typeof inferConversationContext>) {
  if (contextInfo.scenario === 'performance review') {
    return 'Which result from the last review period are you most proud of, and why did it matter?';
  }

  if (contextInfo.scenario === 'sprint review') {
    return 'What is the main result from this sprint that you want the room to remember first?';
  }

  if (contextInfo.scenario === 'standup') {
    return 'What did you finish since the last update, and what is your top priority today?';
  }

  if (contextInfo.scenario === 'interview' && contextInfo.learnerRole === 'candidate') {
    return 'Could you start with the project that best shows your judgement and impact?';
  }

  return 'What is the main point you want to land in this conversation?';
}

function buildLeadConversationOpening(contextInfo: ReturnType<typeof inferConversationContext>) {
  if (contextInfo.scenario === 'interview') {
    return 'Thanks for meeting with me. I can start with the project most relevant to this role, or with a short summary of my background.';
  }

  if (contextInfo.scenario === 'performance review' || contextInfo.scenario === 'one-to-one') {
    return 'Sure. I can start with the main result from this period, then the area where I still need support.';
  }

  return `Sure. I can start with a quick summary of ${contextInfo.focus}, then go into the detail that matters most.`;
}

function buildPromptMatchedSuggestions(prompt: string, contextInfo: ReturnType<typeof inferConversationContext>) {
  const lower = normalizeWhitespace(prompt).toLowerCase();
  const area = pickContextArea(contextInfo, 1);

  if (/finish|finished|result|progress|highlight|remember|impact/.test(lower)) {
    return [
      'The main result I want to highlight is...',
      `The clearest progress on ${area} is...`,
      'What matters most here is...',
    ];
  }

  if (/priority|next step|next priority|decision/.test(lower)) {
    return [
      'The next step I want to confirm is...',
      `My top priority on ${area} is...`,
      'What I need from the room now is...',
    ];
  }

  if (/blocked|blocker|risk|worr|slow/.test(lower)) {
    return [
      'The main blocker right now is...',
      `The biggest risk around ${area} is...`,
      'The support I need to unblock this is...',
    ];
  }

  if (/trade-off|decision|defend|challenge/.test(lower)) {
    return [
      'The hardest trade-off was...',
      'The decision came down to...',
      'I would defend that choice because...',
    ];
  }

  if (/improve first|first 30|first thing/.test(lower)) {
    return [
      'The first thing I would improve is...',
      'I would start by simplifying...',
      'My first change would be...',
    ];
  }

  if (/support|manager/.test(lower)) {
    return [
      'The support I need most is...',
      'What would help me most is...',
      'I would ask my manager for...',
    ];
  }

  return [
    `The main point for me is ${area}, because...`,
    'The most relevant detail here is...',
    'The next thing I would say is...',
  ];
}

function buildRoleAwareSuggestions(
  scenarioConfig: ScenarioConfig,
  contextInfo: ReturnType<typeof inferConversationContext>,
  learnerLeadsConversation: boolean,
) {
  if (learnerLeadsConversation) {
    return scenarioConfig.starterSuggestions.length ? scenarioConfig.starterSuggestions : scenarioConfig.fallbackSuggestions;
  }

  return buildPromptMatchedSuggestions(buildDefaultOpeningQuestion(contextInfo), contextInfo);
}

function buildCounterpartAnswer(contextInfo: ReturnType<typeof inferConversationContext>, userReply: string) {
  const lower = userReply.toLowerCase();

  if (/support|help/.test(lower)) {
    return `The support I need most is faster decisions around ${contextInfo.focus}, so the team can move without waiting on the same blocker.`;
  }

  if (/risk|blocker|delay/.test(lower)) {
    return `The main risk is still ${contextInfo.focus}, and I want to reduce it before the next checkpoint rather than carry it into the release.`;
  }

  if (/proud|result|impact|win/.test(lower)) {
    return `The strongest result was the progress around ${contextInfo.focus}, because it gave the team a clearer path and reduced uncertainty for the next step.`;
  }

  if (/next|priority|plan/.test(lower)) {
    return `The next priority is to keep ${contextInfo.focus} moving while making the owner and deadline explicit for the rest of the team.`;
  }

  return `The key point for me is ${contextInfo.focus}, and I would explain it with one concrete result and the next action.`;
}

function buildFallbackAssistantQuestion(
  contextInfo: ReturnType<typeof inferConversationContext>,
  scenarioKey: string,
  userReply: string,
  userTurnCount: number,
) {
  const lower = normalizeWhitespace(userReply).toLowerCase();
  const area = pickContextArea(contextInfo, userTurnCount);

  if (scenarioKey === 'interview' || contextInfo.scenario === 'interview') {
    if (userTurnCount === 1) {
      return 'What was the hardest trade-off in that work?';
    }
    if (/metric|impact|result|improve|reduced|increased/.test(lower)) {
      return 'How would you measure the impact of that work in a way the team would trust?';
    }
    if (userTurnCount === 2) {
      return 'What would your first 30 days look like if you joined this team?';
    }
    return 'If I pushed back on that answer, what concrete example would you use to support it?';
  }

  if (scenarioKey === 'standup' || contextInfo.scenario === 'standup') {
    if (userTurnCount === 1) {
      return `What is your top priority today on ${area}?`;
    }
    if (/no\b.*block|nothing\s+blocks|nothing\s+is\s+blocking/.test(lower)) {
      return 'Good. What do you want the team to remember by the end of today?';
    }
    if (/block|risk|issue|problem|delay/.test(lower)) {
      return 'Understood. What exactly is blocking you there, and what support do you need from the team?';
    }
    return 'What might still slow you down later today, even if it is not a blocker yet?';
  }

  if (scenarioKey === 'oneToOne' || contextInfo.scenario === 'performance review' || contextInfo.scenario === 'one-to-one') {
    if (userTurnCount === 1) {
      return 'Where do you feel you have grown most since the last review?';
    }
    if (/support|help|manager/.test(lower)) {
      return 'What kind of support would make the biggest difference in the next period?';
    }
    if (/result|impact|proud|win/.test(lower)) {
      return 'How would you explain the business impact of that result to your manager?';
    }
    return 'What goal would you most like to align on for the next period?';
  }

  if (contextInfo.scenario === 'sprint review') {
    if (userTurnCount === 1) {
      return `Which part of ${area} needs the clearest decision today?`;
    }
    if (/risk|issue|delay|blocker/.test(lower)) {
      return 'What is your plan to reduce that risk before the next checkpoint?';
    }
    if (userTurnCount === 2) {
      return `What is the main risk the room still needs to understand about ${area}?`;
    }
    return 'What next step, owner, or deadline do you want the room to confirm before the review ends?';
  }

  if (scenarioKey === 'meeting') {
    if (userTurnCount === 1) {
      return `Which part of ${area} needs the clearest decision in this conversation?`;
    }
    if (/risk|issue|delay|concern/.test(lower)) {
      return 'What would help the group understand that risk more clearly?';
    }
    if (/result|impact|progress/.test(lower)) {
      return 'How would you frame that result in one sentence for the room?';
    }
    return 'What practical next step should the group align on before the meeting ends?';
  }

  return buildDefaultOpeningQuestion(contextInfo);
}

function buildFallbackFeedback(template: string, userReply: string, contextInfo: ReturnType<typeof inferConversationContext>, learnerLeadsConversation: boolean) {
  const trimmed = userReply.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  const notes: string[] = [];

  if (learnerLeadsConversation && !/\?/.test(trimmed)) {
    notes.push('Because you are leading the conversation, make the next turn a clear question.');
  }

  if (!learnerLeadsConversation && wordCount < 8) {
    notes.push('Add one concrete detail from the real meeting context.');
  }

  if (trimmed && !/[.!?]$/.test(trimmed)) {
    notes.push('Finish the message as one complete sentence.');
  }

  if (!notes.length) {
    return formatTemplate(template, {
      scenarioLabel: contextInfo.scenario,
      goal: '',
      contextSummary: contextInfo.subject,
      userReply: trimmed,
    });
  }

  return notes.join(' ');
}

export class CoachChatSessionService {
  constructor(
    private readonly sessionStore: SessionStore<CoachChatSession>,
    private readonly contentService: ContentService,
  ) {}

  private async getConfig() {
    const content = await this.contentService.getContent();
    const practice = asRecord(content.meta.practice);
    const learningChat = getNestedRecord(practice, ['learningChat']);
    return {
      config: learningChat,
      scenarios: getNestedRecord(learningChat, ['scenarios']),
    };
  }

  private getScenarioConfig(config: Record<string, unknown>, key: string) {
    const scenarioKey = normalizeScenarioKey(config, key);
    const scenario = asRecord(getNestedRecord(config, ['scenarios'])[scenarioKey]);
    return {
      key: scenarioKey,
      data: scenario,
      label: asString(scenario.label, scenarioKey),
      starterSuggestions: asStringArray(scenario.starterSuggestions).slice(0, 3),
      fallbackSuggestions: asStringArray(scenario.fallbackSuggestions).slice(0, 3),
    };
  }

  async start(context: string, goal: string, scenario: string) {
    const { config } = await this.getConfig();
    const normalizedContext = context.trim();
    const normalizedGoal = goal.trim() || asString(config.defaultGoal);
    const resolvedScenario = mapInferredScenarioKey(config, normalizedContext, normalizedGoal, scenario);
    const scenarioConfig = this.getScenarioConfig(config, resolvedScenario);
    const capabilities = asRecord(config.capabilities);
    const contextInfo = inferConversationContext(normalizedContext, normalizedGoal || 'the current conversation');
    const templateValues = createTemplateValues({ context: normalizedContext, goal: normalizedGoal }, scenarioConfig.label);
    const openingReply = contextInfo.learnerLeadsConversation
      ? buildLeadConversationOpening(contextInfo)
      : (contextInfo.scenario !== 'meeting' && scenarioConfig.key === 'meeting'
          ? buildDefaultOpeningQuestion(contextInfo)
          : (scenarioConfig.starterSuggestions[0] || buildDefaultOpeningQuestion(contextInfo)));

    const session: CoachChatSession = {
      sessionId: crypto.randomUUID(),
      context: normalizedContext,
      goal: normalizedGoal,
      scenario: scenarioConfig.key,
      completed: false,
      messages: [message('assistant', openingReply)],
      feedback: formatTemplate(asString(config.openingFeedbackTemplate), templateValues),
      suggestions: contextInfo.learnerLeadsConversation
        ? buildRoleAwareSuggestions(scenarioConfig, contextInfo, true)
        : buildPromptMatchedSuggestions(openingReply, contextInfo),
      capabilities: {
        text: asBoolean(capabilities.text, true),
        speechToText: asBoolean(capabilities.speechToText, false),
        textToSpeech: asBoolean(capabilities.textToSpeech, false),
      },
      messageLimit: asNumber(config.messageLimit, 4),
      transcriptMode: 'text',
    };

    await this.sessionStore.set(session);
    return session;
  }

  async respond(sessionId: string, userReply: string) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error('Session not found.');
    }

    const trimmedReply = userReply.trim();
    if (!trimmedReply) {
      throw new Error('User reply is required.');
    }
    if (!looksMeaningfulUserInput(trimmedReply)) {
      throw new Error('User reply is required.');
    }

    const { config } = await this.getConfig();
    const scenarioConfig = this.getScenarioConfig(config, session.scenario);
    const contextInfo = inferConversationContext(session.context, session.goal || 'the current conversation');
    const templateValues = createTemplateValues(session, scenarioConfig.label, trimmedReply);

    session.messages.push(message('user', trimmedReply));
    const userTurnCount = session.messages.filter((item) => item.role === 'user').length;

    let nextTurn: CoachChatTurn;
    if (userTurnCount >= session.messageLimit) {
      nextTurn = {
        reply: formatTemplate(asString(config.closingReplyTemplate), templateValues),
        feedback: formatTemplate(asString(config.closingFeedbackTemplate), templateValues),
        suggestions: [],
      };
      session.completed = true;
    } else {
      try {
        nextTurn = await withChatProvider(env.LLM_TEXT_PROVIDER, (provider) =>
          provider.generateCoachTurn({
            systemPrompt: asString(config.systemPrompt),
            prompt: [
              `Scenario key: ${scenarioConfig.key}`,
              `Scenario label: ${scenarioConfig.label}`,
              `Learner goal: ${session.goal}`,
              `Learner context: ${session.context || 'Not provided'}`,
              `Inferred scenario: ${contextInfo.scenario}`,
              `Inferred focus: ${contextInfo.subject}`,
              `Learner role hint: ${contextInfo.learnerRole}`,
              `Counterpart role hint: ${contextInfo.counterpartRole}`,
              `Learner leads the conversation: ${contextInfo.learnerLeadsConversation ? 'yes' : 'no'}`,
              'Transcript mode: text',
              'Infer the learner role and the counterpart role from the learner goal and context before you reply.',
              'Do not default to candidate mode. If the learner is interviewing someone, leading a review, running a negotiation, or presenting, keep that role and reply from the counterpart perspective.',
              'Use profession-specific language, realistic priorities, and domain nuance from the learner context whenever it is available.',
              'Conversation so far:',
              serializeTranscript(session.messages),
              'Return JSON with keys reply, feedback, suggestions.',
              'reply: 1-3 concise sentences as the other person in the scenario, grounded in the inferred roles and meeting context.',
              'feedback: 1-2 concise coaching sentences about the learner\'s latest message, covering clarity, professionalism, and context fit.',
              'suggestions: array of up to 3 short candidate replies for the learner\'s next turn.',
            ].join('\n\n'),
            responseShape: 'freeform',
          }),
        );
      } catch (error) {
        if (contextInfo.learnerLeadsConversation) {
          nextTurn = {
            reply: buildCounterpartAnswer(contextInfo, trimmedReply),
            feedback: buildFallbackFeedback(asString(config.fallbackFeedbackTemplate), trimmedReply, contextInfo, true),
            suggestions: buildRoleAwareSuggestions(scenarioConfig, contextInfo, true),
            providerError: error instanceof Error ? error.message : String(error),
          };
        } else {
          const reply = buildFallbackAssistantQuestion(contextInfo, scenarioConfig.key, trimmedReply, userTurnCount);
          nextTurn = {
            reply,
            feedback: buildFallbackFeedback(asString(config.fallbackFeedbackTemplate), trimmedReply, contextInfo, false),
            suggestions: buildPromptMatchedSuggestions(reply, contextInfo),
            providerError: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }

    const safeSuggestions = asStringArray(nextTurn.suggestions).slice(0, 3);
    const replyText = asString(nextTurn.reply) || formatTemplate(asString(config.fallbackReplyTemplate), templateValues);
    const feedbackText = asString(nextTurn.feedback) || formatTemplate(asString(config.fallbackFeedbackTemplate), templateValues);
    const fallbackSuggestions = contextInfo.learnerLeadsConversation
      ? buildRoleAwareSuggestions(scenarioConfig, contextInfo, true)
      : buildPromptMatchedSuggestions(replyText, contextInfo);

    session.messages.push(message('assistant', replyText));
    session.feedback = feedbackText;
    session.suggestions = safeSuggestions.length ? safeSuggestions : fallbackSuggestions;
    session.providerError = asString(nextTurn.providerError);

    await this.sessionStore.set(session);
    return session;
  }
}







