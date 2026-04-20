import crypto from 'node:crypto';
import type {
  AnsweringMode,
  AnsweringQuestionTurn,
  AnsweringSession,
  AnsweringSessionMode,
  AnsweringSessionSummary,
  AnsweringTurnEvaluation,
} from '@softskills/domain';
import { env } from '../../config/env';
import { withChatProvider } from '../../providers/providerRegistry';
import { inferConversationContext } from '../shared/contextSummary';
import type { AnsweringEvaluationDraft, AnsweringQuestionDraft } from '../../providers/types';
import type { ContentService } from '../content/content.service';
import type { SessionStore } from '../session/session.store';

type ReactionOptionConfig = {
  id: string;
  text: string;
  preferred: boolean;
};

type AnsweringSessionState = AnsweringSession & {
  questionPlan: AnsweringMode[];
};

const ANSWERING_REACTION_TYPE_ORDER: AnsweringMode[] = ['good', 'difficult', 'unnecessary', 'irrelevant'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampScore(value: unknown) {
  const parsed = Math.round(asNumber(value, 3));
  return Math.max(1, Math.min(5, parsed));
}

function formatTemplate(template: string, values: Record<string, string>) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_match, key) => values[key] ?? '');
}

function summarizeContext(context: string) {
  return inferConversationContext(context, 'your upcoming meeting topic').subject;
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

function normalizeWhitespace(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSentence(value: string) {
  const clean = normalizeWhitespace(value);
  if (!clean) {
    return '';
  }

  const withCapital = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!?]$/.test(withCapital) ? withCapital : `${withCapital}.`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingReactionPhrase(answerText: string, reactionPhrases: string[]) {
  let next = normalizeWhitespace(answerText);
  for (const phrase of uniqueStrings(reactionPhrases.map((item) => normalizeWhitespace(item)).filter(Boolean))) {
    const pattern = new RegExp(`^${escapeRegExp(phrase)}(?:[,:;.!?\\-]+\\s*|\\s+)`, 'i');
    next = next.replace(pattern, '').trim();
  }

  return next;
}

function splitAnswerSentences(value: string) {
  return normalizeWhitespace(value).match(/[^.!?]+[.!?]?/g)?.map((item) => normalizeWhitespace(item)).filter(Boolean) || [];
}

function isQuestionLikeSentence(value: string) {
  const next = normalizeWhitespace(value).toLowerCase();
  if (!next) {
    return false;
  }

  return /[?]\s*$/.test(next) || /^(can|could|would|will|should|may|might|do|does|did|is|are|was|were|have|has|what|when|where|which|who|whom|whose|why|how)\b/.test(next);
}

function removeQuestionSentences(value: string) {
  return splitAnswerSentences(value)
    .filter((sentence) => !isQuestionLikeSentence(sentence))
    .join(' ')
    .trim();
}

function containsQuestionSentence(value: string) {
  return splitAnswerSentences(value).some((sentence) => isQuestionLikeSentence(sentence));
}

function normalizeAnswerStatementBody(value: string) {
  const clean = normalizeWhitespace(value).replace(/[?]+$/g, '.');
  if (!clean) {
    return '';
  }

  const withCapital = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!]$/.test(withCapital) ? withCapital : `${withCapital}.`;
}

function sanitizeImprovedAnswerBody(generatedBody: string, fallbackBody: string, chosenReactionText: string) {
  const generatedWithoutReaction = stripLeadingReactionPhrase(generatedBody, [chosenReactionText]);
  const fallbackWithoutReaction = stripLeadingReactionPhrase(fallbackBody, [chosenReactionText]);
  const sourceBody = containsQuestionSentence(generatedWithoutReaction)
    ? fallbackWithoutReaction
    : generatedWithoutReaction || fallbackWithoutReaction;
  const answerOnly = removeQuestionSentences(sourceBody) || removeQuestionSentences(fallbackWithoutReaction);

  return normalizeAnswerStatementBody(answerOnly || 'I would answer directly with the main priority, result, or next step.');
}

function buildImprovedAnswerWithChosenReaction(chosenReactionText: string, answerBody: string, fallbackBody = '') {
  const reaction = normalizeSentence(chosenReactionText);
  const bodyOnly = sanitizeImprovedAnswerBody(answerBody, fallbackBody, chosenReactionText);

  if (!reaction) {
    return bodyOnly;
  }

  if (!bodyOnly) {
    return reaction;
  }

  return `${reaction} ${bodyOnly}`.trim();
}

function toReactionOptions(rawValue: unknown): ReactionOptionConfig[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((item) => {
      const record = asRecord(item);
      return {
        id: asString(record.id),
        text: asString(record.text),
        preferred: asBoolean(record.preferred),
      };
    })
    .filter((item) => item.id && item.text);
}

function stripSessionState(session: AnsweringSessionState): AnsweringSession {
  const { questionPlan, ...publicSession } = session;
  void questionPlan;
  return publicSession;
}

function stripLeadingArticle(value: string) {
  return normalizeWhitespace(value).replace(/^(the|a|an)\s+/i, '');
}

function pickScenarioArea(contextInfo: ReturnType<typeof inferConversationContext>, index: number) {
  const areas = uniqueStrings(contextInfo.focusAreas.map((item) => stripLeadingArticle(item)).filter(Boolean));
  if (!areas.length) {
    return stripLeadingArticle(contextInfo.focus || contextInfo.subject || 'the main topic') || 'the main topic';
  }

  return areas[(Math.max(index, 1) - 1) % areas.length] || areas[0] || 'the main topic';
}

function buildScenarioFallbackQuestions(type: AnsweringMode, contextInfo: ReturnType<typeof inferConversationContext>, index: number) {
  const area = pickScenarioArea(contextInfo, index);

  if (contextInfo.scenario === 'sprint review') {
    const byType: Record<AnsweringMode, string[]> = {
      good: [
        'Which result should we highlight first in this sprint review, and why does it matter?',
        `What progress on ${area} do you want the room to remember after this sprint review?`,
        `What decision or next step around ${area} should we confirm before the review ends?`,
      ],
      difficult: [
        `What is the biggest risk still attached to ${area} before release?`,
        `What worries you most about the current state of ${area}?`,
        `If someone challenges the readiness of ${area}, how would you answer?`,
      ],
      unnecessary: [
        `Do we really need to go into every background detail behind ${area} right now?`,
        `Can you walk us through every tiny step behind ${area} before we move on?`,
        `Could you give the full history of ${area} even if it is not needed for this decision?`,
      ],
      irrelevant: [
        `Before we continue, could we switch away from ${area} and discuss something unrelated?`,
        `Can we pause the main review and go into a side topic that does not affect today\'s decision?`,
        `Could we leave ${area} for now and move into a different topic that is not on the agenda?`,
      ],
    };
    return byType[type] || [];
  }

  if (contextInfo.scenario === 'performance review' || contextInfo.scenario === 'one-to-one') {
    const byType: Record<AnsweringMode, string[]> = {
      good: [
        'Which result from this period are you most ready to highlight, and why does it matter?',
        `What progress on ${area} would you want your manager to remember first?`,
        'What next goal would you like to agree on before this review ends?',
      ],
      difficult: [
        `Where do you think your work on ${area} still needs improvement?`,
        'What would you say if your manager challenged the pace of your progress?',
        'Which part of your recent work would be hardest to defend, and how would you explain it?',
      ],
      unnecessary: [
        `Can you describe every small task behind ${area} instead of staying on the main result?`,
        'Could you go through the full background even if the main point is already clear?',
        'Would you explain every detail of the process rather than focusing on the impact?',
      ],
      irrelevant: [
        'Before we continue, can we leave your main priorities aside and talk about something less relevant?',
        `Could we switch away from ${area} even though it matters more for this review?`,
        'Would it make sense to spend this time on a side topic that does not affect your next goal?',
      ],
    };
    return byType[type] || [];
  }

  if (contextInfo.scenario === 'interview' && contextInfo.learnerRole === 'candidate') {
    const byType: Record<AnsweringMode, string[]> = {
      good: [
        'Which project should we start with if you want to show your strongest impact?',
        `What result from ${area} would best show your judgement and technical depth?`,
        'What part of your background is most relevant to this role, and why?',
      ],
      difficult: [
        `What was the hardest trade-off you had to make around ${area}?`,
        'Which decision in that work would you defend if I challenged it?',
        'What part of that project did not go as planned, and how did you handle it?',
      ],
      unnecessary: [
        `Could you explain every small implementation detail behind ${area} before we agree the bigger picture?`,
        'Would you walk me through the full history of the project even if only one part matters for this role?',
        'Can you go deep into a side detail that does not really change the hiring decision?',
      ],
      irrelevant: [
        'Before we continue, could we move away from your core experience and talk about something unrelated to the role?',
        `Can we stop discussing ${area} and switch to a topic that does not affect the decision for this job?`,
        'Would you mind focusing on a side issue that is not really relevant to the position?',
      ],
    };
    return byType[type] || [];
  }

  const byType: Record<AnsweringMode, string[]> = {
    good: [
      `Which result around ${area} should we highlight first, and why does it matter?`,
      `What progress on ${area} do you want the room to remember after this ${contextInfo.scenario}?`,
      `What next step on ${area} should we confirm before this ${contextInfo.scenario} ends?`,
    ],
    difficult: [
      `What is the biggest risk around ${area} right now?`,
      `What would you say if someone challenged the current plan for ${area}?`,
      `What still worries you most about ${area}?`,
    ],
    unnecessary: [
      `Could you go through every tiny detail behind ${area} even if the room only needs the main point?`,
      `Would you explain the full background to ${area} before we agree the next step?`,
      `Can you spend time on a low-value detail from ${area} right now?`,
    ],
    irrelevant: [
      `Before we continue, could we switch away from ${area} and talk about a side topic?`,
      `Can we leave ${area} aside for a moment even though it is the main topic of this ${contextInfo.scenario}?`,
      `Would you mind moving away from ${area} to something less relevant right now?`,
    ],
  };
  return byType[type] || [];
}

export class AnsweringSessionService {
  constructor(
    private readonly sessionStore: SessionStore<AnsweringSession>,
    private readonly contentService: ContentService,
  ) {}

  private async getConfig() {
    const content = await this.contentService.getContent();
    const practice = asRecord(content.meta.practice);
    const answeringSession = asRecord(practice.answeringSession);
    return { content, config: answeringSession };
  }

  private getQuestionTypeConfig(config: Record<string, unknown>, type: AnsweringMode) {
    return asRecord(asRecord(config.questionTypes)[type]);
  }

  private getQuestionTypeLabel(config: Record<string, unknown>, type: AnsweringMode) {
    return asString(this.getQuestionTypeConfig(config, type).label, type);
  }

  private buildQuestionPlan(config: Record<string, unknown>, mode: AnsweringSessionMode) {
    const questionCount = Math.max(1, asNumber(config.questionCount, 10));
    if (mode !== 'mixed') {
      return Array.from({ length: questionCount }, () => mode);
    }

    const configuredPlan = asStringArray(config.mixedQuestionTypes).filter((item): item is AnsweringMode => (
      item === 'good' || item === 'difficult' || item === 'unnecessary' || item === 'irrelevant'
    ));
    const seed: AnsweringMode[] = configuredPlan.length ? configuredPlan : ['good', 'good', 'good', 'good', 'difficult', 'difficult', 'unnecessary', 'unnecessary', 'irrelevant', 'irrelevant'];
    const plan: AnsweringMode[] = [];
    while (plan.length < questionCount) {
      for (const item of seed) {
        if (plan.length >= questionCount) {
          break;
        }
        plan.push(item);
      }
    }
    return plan;
  }

  private buildFallbackQuestion(config: Record<string, unknown>, type: AnsweringMode, context: string, index: number) {
    const typeConfig = this.getQuestionTypeConfig(config, type);
    const contextInfo = inferConversationContext(context, 'your upcoming meeting topic');
    const area = pickScenarioArea(contextInfo, index);
    const values = {
      topic: contextInfo.focus,
      focus: contextInfo.subject,
      scenario: contextInfo.scenario,
      contextSummary: contextInfo.subject,
      learnerRole: contextInfo.learnerRole,
      counterpartRole: contextInfo.counterpartRole,
      area,
      index: String(index),
      questionType: this.getQuestionTypeLabel(config, type),
    };
    const scenarioQuestions = buildScenarioFallbackQuestions(type, contextInfo, index);
    if (scenarioQuestions.length) {
      return scenarioQuestions[(Math.max(index, 1) - 1) % scenarioQuestions.length] || scenarioQuestions[0] || 'What should we focus on in this meeting?';
    }

    const templates = asStringArray(typeConfig.fallbackQuestions);
    const fallbackTemplate = templates.length
      ? templates[(Math.max(index, 1) - 1) % templates.length]
      : 'What should we focus on in this {scenario}?';
    return formatTemplate(fallbackTemplate, values);
  }
  private getReactionCategoryLabel(config: Record<string, unknown>, type: AnsweringMode) {
    const typeConfig = this.getQuestionTypeConfig(config, type);
    const fallbackLabels: Record<AnsweringMode, string> = {
      good: "It's a good question",
      difficult: "It's a difficult question",
      unnecessary: "It's an unnecessary question",
      irrelevant: "It's an irrelevant question",
    };
    return asString(typeConfig.selectorLabel, fallbackLabels[type]);
  }

  private buildReactionOptions(config: Record<string, unknown>, type: AnsweringMode) {
    const typeConfig = this.getQuestionTypeConfig(config, type);
    const options = toReactionOptions(typeConfig.reactionOptions);
    if (options.length) {
      const preferredOptions = options.filter((item) => item.preferred);
      return (preferredOptions.length ? preferredOptions : options).map((item) => ({ ...item, preferred: true }));
    }

    const fallbackOptions: Record<AnsweringMode, ReactionOptionConfig[]> = {
      good: [
        { id: 'good-thanks', text: 'Thanks, that is a useful question.', preferred: true },
      ],
      difficult: [
        { id: 'difficult-direct', text: 'Sure, let me answer that directly.', preferred: true },
      ],
      unnecessary: [
        { id: 'unnecessary-redirect', text: 'That is not really important right now.', preferred: true },
      ],
      irrelevant: [
        { id: 'irrelevant-move-on', text: 'We already covered that, so let us move on.', preferred: true },
      ],
    };

    return fallbackOptions[type] || fallbackOptions.good;
  }

  private buildReactionCategories(config: Record<string, unknown>) {
    return ANSWERING_REACTION_TYPE_ORDER.map((type) => {
      const options = this.buildReactionOptions(config, type).map((item) => ({
        id: item.id,
        text: item.text,
        categoryType: type,
      }));
      return {
        type,
        label: this.getReactionCategoryLabel(config, type),
        options,
      };
    });
  }

  private async generateTurn(config: Record<string, unknown>, type: AnsweringMode, context: string, index: number): Promise<AnsweringQuestionTurn> {
    const typeConfig = this.getQuestionTypeConfig(config, type);
    const contextInfo = inferConversationContext(context, 'your upcoming meeting topic');
    const reactionCategories = this.buildReactionCategories(config);
    const reactionOptions = reactionCategories.flatMap((category) => category.options);
    const preferredReactionIds = reactionCategories.find((category) => category.type === type)?.options.map((item) => item.id) || [];
    const preferredReactionText = reactionCategories.find((category) => category.type === type)?.options[0]?.text || reactionOptions[0]?.text || '';
    const fallbackQuestion = this.buildFallbackQuestion(config, type, context, index);
    const typeLabel = this.getQuestionTypeLabel(config, type);
    let questionText = fallbackQuestion;
    let providerError = '';
    const generationSystemPrompt = asString(
      config.answeringQuestionSystemPrompt,
      'Generate one workplace English question for a learner preparing for a meeting, interview, review, presentation, or negotiation. Infer the learner role and the counterpart role from the topic. Do not default to candidate mode. Never echo the learner topic sentence verbatim inside the question. Return JSON with key questionText only.',
    );
    const generationPromptTemplate = asString(
      config.answeringQuestionPromptTemplate,
      'Create one {questionType} workplace question for this scenario: {scenario}. Main focus: {focus}. A specific area to pull from when helpful: {area}. First infer the learner role and the counterpart role from the topic. Ask from the counterpart perspective, keep it realistic for spoken business English, use profession-specific detail where possible, and never quote the whole learner topic sentence back verbatim.',
    );
    const generationPrompt = formatTemplate(generationPromptTemplate, {
      questionType: typeLabel,
      topic: contextInfo.subject,
      focus: contextInfo.focus,
      scenario: contextInfo.scenario,
      contextSummary: contextInfo.subject,
      learnerRole: contextInfo.learnerRole,
      counterpartRole: contextInfo.counterpartRole,
      index: String(index),
      guidance: asString(typeConfig.generatorGuidance),
      fallbackQuestion,
      preferredReaction: preferredReactionText,
    });
    try {
      const generated = await withChatProvider(env.LLM_TEXT_PROVIDER, (provider) => provider.generateAnsweringQuestion({
        systemPrompt: generationSystemPrompt,
        prompt: generationPrompt,
        responseShape: 'answering-question',
      }));
      questionText = normalizeWhitespace(asString((generated as AnsweringQuestionDraft).questionText, fallbackQuestion)) || fallbackQuestion;
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
    }
    return {
      turnId: crypto.randomUUID(),
      index,
      questionType: type,
      questionTypeLabel: typeLabel,
      questionText,
      reactionOptions,
      reactionCategories,
      preferredReactionIds,
      preferredReactionText,
      providerError: providerError || undefined,
    };
  }
  private buildFallbackEvaluation(config: Record<string, unknown>, turn: AnsweringQuestionTurn, reactionAccepted: boolean, answerText: string, providerError: string): AnsweringTurnEvaluation {
    const typeConfig = this.getQuestionTypeConfig(config, turn.questionType);
    const normalizedAnswer = normalizeWhitespace(answerText);
    const hasCapitalLetter = /^[A-Z]/.test(normalizedAnswer);
    const hasEndPunctuation = /[.!?]$/.test(normalizedAnswer);
    const hasDetail = normalizedAnswer.split(' ').length >= 7;
    const hasPoliteLanguage = /\b(please|thank|thanks|glad|happy|certainly|of course)\b/i.test(normalizedAnswer);

    const politenessScore = Math.max(1, Math.min(5, (reactionAccepted ? 3 : 1) + (hasPoliteLanguage ? 1 : 0) + (hasDetail ? 1 : 0)));
    const grammarScore = Math.max(1, Math.min(5, 2 + (hasCapitalLetter ? 1 : 0) + (hasEndPunctuation ? 1 : 0) + (hasDetail ? 1 : 0)));
    const grammarFixes = uniqueStrings([
      hasCapitalLetter ? '' : asString(config.missingCapitalFix, 'Start the answer with a capital letter.'),
      hasEndPunctuation ? '' : asString(config.missingPunctuationFix, 'End the answer with a full stop or question mark.'),
      hasDetail ? '' : asString(config.addDetailFix, 'Add one concrete detail or next step.'),
    ]).slice(0, 3);
    const toneFixes = uniqueStrings([
      reactionAccepted ? '' : asString(asRecord(typeConfig.reactionFeedback).incorrect, 'Choose a calmer and more appropriate reaction phrase first.'),
      hasPoliteLanguage ? '' : asString(config.politeToneFix, 'Use slightly more polite business language.'),
      asString(typeConfig.professionalFocus),
    ]).slice(0, 3);
    const improvedAnswer = buildImprovedAnswerWithChosenReaction(
      turn.chosenReactionText || turn.preferredReactionText,
      answerText,
      answerText,
    );
    const briefFeedback = reactionAccepted
      ? asString(asRecord(typeConfig.reactionFeedback).accepted, 'Good reaction. Now keep the answer concise and professional.')
      : asString(asRecord(typeConfig.reactionFeedback).incorrect, 'A better reaction phrase would sound calmer and more professional before the answer.');

    return {
      reactionAccepted,
      politenessScore,
      grammarScore,
      briefFeedback,
      improvedAnswer,
      grammarFixes,
      toneFixes,
      providerError: providerError || undefined,
    };
  }

  private async evaluateTurn(config: Record<string, unknown>, turn: AnsweringQuestionTurn, reactionOptionId: string, answerText: string, context: string): Promise<AnsweringTurnEvaluation> {
    const selectedReaction = turn.reactionOptions.find((item) => item.id === reactionOptionId);
    const reactionAccepted = turn.preferredReactionIds.includes(reactionOptionId);
    const contextInfo = inferConversationContext(context, 'your upcoming meeting topic');
    const evaluationSystemPrompt = asString(
      config.answeringEvaluationSystemPrompt,
      'Evaluate one workplace English answer. Infer the learner role and meeting context from the topic first, and do not rewrite the answer from the wrong perspective. Return JSON with politenessScore, grammarScore, briefFeedback, improvedAnswer, grammarFixes, toneFixes.',
    );
    const evaluationPromptTemplate = asString(
      config.answeringEvaluationPromptTemplate,
      [
        'Meeting topic: {topic}',
        'Meeting scenario: {scenario}',
        'Primary focus: {focus}',
        'Learner role: {learnerRole}',
        'Counterpart role: {counterpartRole}',
        'Question type: {questionType}',
        'Question: {questionText}',
        'Chosen reaction: {chosenReaction}',
        'Preferred reaction: {preferredReaction}',
        'Learner answer: {answerText}',
        'First infer the learner role and the counterpart role from the topic, then assess whether the answer matches that context.',
        'Score politeness and grammar from 1 to 5.',
        'Return a short professional rewrite that keeps the learner in the correct role and uses realistic domain language.',
      ].join('\n'),
    );
    const evaluationPrompt = formatTemplate(evaluationPromptTemplate, {
      topic: contextInfo.subject,
      scenario: contextInfo.scenario,
      focus: contextInfo.focus,
      learnerRole: contextInfo.learnerRole,
      counterpartRole: contextInfo.counterpartRole,
      questionType: turn.questionTypeLabel,
      questionText: turn.questionText,
      chosenReaction: selectedReaction?.text || '',
      preferredReaction: turn.preferredReactionText,
      answerText: normalizeWhitespace(answerText),
    });
    try {
      const generated = await withChatProvider(env.LLM_TEXT_PROVIDER, (provider) => provider.generateAnsweringEvaluation({
        systemPrompt: evaluationSystemPrompt,
        prompt: evaluationPrompt,
        responseShape: 'answering-evaluation',
      }));
      const payload = generated as AnsweringEvaluationDraft;
      const sanitizedImprovedAnswer = buildImprovedAnswerWithChosenReaction(
        selectedReaction?.text || turn.preferredReactionText,
        asString(payload.improvedAnswer, ''),
        answerText,
      );
      return {
        reactionAccepted,
        politenessScore: clampScore(payload.politenessScore),
        grammarScore: clampScore(payload.grammarScore),
        briefFeedback: asString(payload.briefFeedback, ''),
        improvedAnswer: sanitizedImprovedAnswer,
        grammarFixes: uniqueStrings(asStringArray(payload.grammarFixes)).slice(0, 3),
        toneFixes: uniqueStrings(asStringArray(payload.toneFixes)).slice(0, 3),
      };
    } catch (error) {
      const providerError = error instanceof Error ? error.message : String(error);
      return this.buildFallbackEvaluation(config, turn, reactionAccepted, answerText, providerError);
    }
  }
  private buildSummary(config: Record<string, unknown>, turns: AnsweringQuestionTurn[]): AnsweringSessionSummary {
    const evaluatedTurns = turns.filter((turn) => turn.evaluation);
    const total = evaluatedTurns.length || 1;
    const averagePolitenessScore = Number((evaluatedTurns.reduce((sum, turn) => sum + (turn.evaluation?.politenessScore || 0), 0) / total).toFixed(1));
    const averageGrammarScore = Number((evaluatedTurns.reduce((sum, turn) => sum + (turn.evaluation?.grammarScore || 0), 0) / total).toFixed(1));
    const byType = new Map<AnsweringMode, { politeness: number; grammar: number; count: number }>();

    for (const turn of evaluatedTurns) {
      const entry = byType.get(turn.questionType) || { politeness: 0, grammar: 0, count: 0 };
      entry.politeness += turn.evaluation?.politenessScore || 0;
      entry.grammar += turn.evaluation?.grammarScore || 0;
      entry.count += 1;
      byType.set(turn.questionType, entry);
    }

    let strongestType: AnsweringMode = 'good';
    let strongestScore = -Infinity;
    let focusType: AnsweringMode = 'good';
    let focusScore = Infinity;
    for (const [type, scores] of byType.entries()) {
      const combined = (scores.politeness + scores.grammar) / Math.max(1, scores.count * 2);
      if (combined > strongestScore) {
        strongestScore = combined;
        strongestType = type;
      }
      if (combined < focusScore) {
        focusScore = combined;
        focusType = type;
      }
    }

    const improvementTips = uniqueStrings([
      ...evaluatedTurns.flatMap((turn) => turn.evaluation?.grammarFixes || []),
      ...evaluatedTurns.flatMap((turn) => turn.evaluation?.toneFixes || []),
      ...asStringArray(config.summaryTipsFallback),
    ]).slice(0, Math.max(1, asNumber(config.summaryTipCount, 3)));

    return {
      averagePolitenessScore,
      averageGrammarScore,
      strongestQuestionType: this.getQuestionTypeLabel(config, strongestType),
      focusQuestionType: this.getQuestionTypeLabel(config, focusType),
      improvementTips,
    };
  }

  async start(context: string, mode: AnsweringSessionMode): Promise<AnsweringSession> {
    const { config } = await this.getConfig();
    const questionPlan = this.buildQuestionPlan(config, mode);
    const session: AnsweringSessionState = {
      sessionId: crypto.randomUUID(),
      mode,
      context,
      totalQuestions: questionPlan.length,
      completed: false,
      currentTurn: await this.generateTurn(config, questionPlan[0], context, 1),
      turns: [],
      questionPlan,
    };

    await this.sessionStore.set(session);
    return stripSessionState(session);
  }

  async respond(sessionId: string, reactionOptionId: string | undefined, userReply: string, transcriptSource: 'text' | 'speech' = 'text'): Promise<AnsweringSession> {
    const { config } = await this.getConfig();
    const session = await this.sessionStore.get(sessionId) as AnsweringSessionState | null;
    if (!session) {
      throw new Error('Session not found.');
    }
    if (!session.currentTurn) {
      throw new Error('The session is already complete.');
    }

    const currentTurn = session.currentTurn;
    const chosenReaction = currentTurn.reactionOptions.find((item) => item.id === reactionOptionId);
    if (!chosenReaction) {
      throw new Error(asString(config.reactionRequiredFeedback, 'Choose a reaction phrase before you submit the answer.'));
    }

    const normalizedReply = normalizeWhitespace(userReply);
    if (!normalizedReply) {
      throw new Error(asString(config.answerRequiredFeedback, 'Type or record your answer before you submit it.'));
    }

    const evaluation = await this.evaluateTurn(config, currentTurn, chosenReaction.id, normalizedReply, session.context);
    const completedTurn: AnsweringQuestionTurn = {
      ...currentTurn,
      chosenReactionId: chosenReaction.id,
      chosenReactionText: chosenReaction.text,
      answerText: normalizedReply,
      transcriptSource,
      evaluation,
    };

    session.turns.push(completedTurn);
    if (session.turns.length >= session.totalQuestions) {
      session.currentTurn = null;
      session.completed = true;
      session.summary = this.buildSummary(config, session.turns);
    } else {
      session.currentTurn = await this.generateTurn(config, session.questionPlan[session.turns.length], session.context, session.turns.length + 1);
    }

    await this.sessionStore.set(session);
    return stripSessionState(session);
  }
}










