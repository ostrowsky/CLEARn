import { env } from '../../config/env';
import type { AskAfterBrief, ClarifyExercise } from '@softskills/domain';
import type { ContentService } from '../content/content.service';
import { withChatProvider } from '../../providers/providerRegistry';
import { detectPracticeProfileKey, inferConversationContext } from '../shared/contextSummary';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
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
  return template.replace(/\{([^}]+)\}/g, (_match, key) => values[key] ?? '');
}

function normalizeClarifyQuestion(value: string) {
  const contractionMap: Array<[RegExp, string]> = [
    [/\bwhat's\b/g, 'what is'],
    [/\bwhen's\b/g, 'when is'],
    [/\bwho's\b/g, 'who is'],
    [/\bwhere's\b/g, 'where is'],
    [/\bhow's\b/g, 'how is'],
    [/\bit's\b/g, 'it is'],
    [/\bthat's\b/g, 'that is'],
    [/\bthere's\b/g, 'there is'],
    [/\bi'm\b/g, 'i am'],
    [/\bi've\b/g, 'i have'],
    [/\byou've\b/g, 'you have'],
    [/\bwe've\b/g, 'we have'],
    [/\bthey've\b/g, 'they have'],
    [/\bcan't\b/g, 'cannot'],
    [/\bdon't\b/g, 'do not'],
    [/\bdidn't\b/g, 'did not'],
    [/\bdoesn't\b/g, 'does not'],
    [/\bwon't\b/g, 'will not'],
    [/\bwouldn't\b/g, 'would not'],
    [/\bcouldn't\b/g, 'could not'],
    [/\bshouldn't\b/g, 'should not'],
    [/\bit'll\b/g, 'it will'],
    [/\byou'll\b/g, 'you will'],
    [/\bwe'll\b/g, 'we will'],
    [/\bthey'll\b/g, 'they will'],
    [/\bmodule\b/g, 'module'],
  ];

  let normalized = String(value || '')
    .toLowerCase()
    .replace(/[РІР‚в„ў`]/g, "'")
    .replace(/[_-]+/g, ' ');

  for (const [pattern, replacement] of contractionMap) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWhitespace(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function joinNaturalList(values: string[]) {
  const clean = uniqueStrings(values.map((item) => normalizeWhitespace(item))).filter(Boolean);
  if (!clean.length) {
    return '';
  }

  if (clean.length === 1) {
    return clean[0];
  }

  if (clean.length === 2) {
    return `${clean[0]} and ${clean[1]}`;
  }

  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

function stripLeadingArticle(value: string) {
  return normalizeWhitespace(value).replace(/^(the|a|an)\s+/i, '');
}

function pickAskAfterFocus(contextInfo: ReturnType<typeof inferConversationContext>, rotatedFacts: string[], offset: number) {
  const focusAreas = contextInfo.focusAreas.map((item) => stripLeadingArticle(item)).filter(Boolean);
  const factFragments = rotatedFacts
    .map((item) => normalizeWhitespace(item).replace(/[.?!]+$/, ''))
    .filter(Boolean);
  const pool = uniqueStrings([...focusAreas, ...factFragments.map((item) => stripLeadingArticle(item))]).filter(Boolean);
  if (!pool.length) {
    return 'that point';
  }

  return pool[Math.abs(offset) % pool.length] || pool[0] || 'that point';
}

function buildAskAfterSpeechLines(
  contextInfo: ReturnType<typeof inferConversationContext>,
  rotatedFacts: string[],
  offset: number,
) {
  const areas = contextInfo.focusAreas.length ? contextInfo.focusAreas : [contextInfo.focus].filter(Boolean);
  const primary = stripLeadingArticle(areas[0] || 'the main update');
  const secondary = stripLeadingArticle(areas[1] || areas[0] || 'the current delivery stability');
  const tertiary = stripLeadingArticle(areas[2] || areas[1] || areas[0] || 'the main release risk');
  const combinedFocus = joinNaturalList(areas) || contextInfo.subject || 'the current discussion';
  const variant = Math.abs(offset) % 3;

  if (contextInfo.scenario === 'performance review') {
    const variants = [
      [
        `In this performance review, the focus is ${combinedFocus}.`,
        `The strongest result this period was around ${primary}, and that is the impact we should open with.`,
        `The next point is ${secondary}, where sharper support or prioritisation would help most.`,
        `The final point is ${tertiary}, because that is the area we want to turn into a clear next-period goal.`,
        'Before we close, we should agree the biggest takeaway and the next development step.',
      ],
      [
        `This review is mainly about ${combinedFocus}.`,
        `One result worth highlighting is the progress on ${primary}.`,
        `Another point is ${secondary}, where the learner still needs a clearer support plan.`,
        `The last theme is ${tertiary}, because that will shape the next review cycle.`,
        'We should finish with one agreed priority and one concrete measure of success.',
      ],
      [
        `The review discussion covers ${combinedFocus}.`,
        `First, we need to clarify the business impact of ${primary}.`,
        `Second, we should discuss what is still difficult around ${secondary}.`,
        `Third, we need to turn ${tertiary} into a realistic next-step plan.`,
        'The meeting should end with a clear goal, owner, and checkpoint for the next period.',
      ],
    ];
    return uniqueStrings(variants[variant] || variants[0] || []).slice(0, 5);
  }

  if (contextInfo.scenario === 'sprint review') {
    const variants = [
      [
        `This sprint review covers ${combinedFocus}.`,
        `The first update is ${primary}, and the team wants to confirm what is ready for the next rollout step.`,
        `The second point is ${secondary}, where the latest check looks better but still needs one clear follow-up action.`,
        `The biggest open risk is ${tertiary}, so the room needs a clear owner before the release decision.`,
        'Before we close, we need to confirm the next decision, the owner, and the checkpoint date.',
      ],
      [
        `Today's sprint review is focused on ${combinedFocus}.`,
        `One highlight is ${primary}, because that is the change most ready to show to stakeholders.`,
        `A second theme is ${secondary}, where the latest run exposed one point we still need to tighten.`,
        `The discussion also needs to cover ${tertiary}, because that is still the biggest risk before release.`,
        'The review should end with one clear release decision and one named owner for the open risk.',
      ],
      [
        `The team is using this sprint review to talk through ${combinedFocus}.`,
        `First, there is progress on ${primary}, and the room needs to understand what changed since the last checkpoint.`,
        `Then there is ${secondary}, where one unresolved detail could still slow the rollout.`,
        `Finally, we need to address ${tertiary}, because that will affect the next release window.`,
        'By the end of the review, we should know the next step, the deadline, and who owns it.',
      ],
    ];
    return uniqueStrings(variants[variant] || variants[0] || []).slice(0, 5);
  }

  if (contextInfo.scenario === 'standup') {
    const variants = [
      [
        `In this standup, the focus is ${combinedFocus}.`,
        `The first update is progress on ${primary} since the last check-in.`,
        `The next point is ${secondary}, which is the top priority for today.`,
        `The main blocker is ${tertiary}, because that is the issue most likely to slow the team down.`,
        'Before we close, we need a clear owner for the blocker and the next checkpoint.',
      ],
      [
        `Today's standup is mainly about ${combinedFocus}.`,
        `One update is the progress on ${primary} since yesterday.`,
        `Another is ${secondary}, which now needs the clearest attention.`,
        `The last point is ${tertiary}, because that may still block delivery later today.`,
        'The team needs to leave the standup with one blocker owner and one next action.',
      ],
      [
        `This standup touches on ${combinedFocus}.`,
        `First, there is a quick result around ${primary}.`,
        `Second, the team needs to align on ${secondary} as the immediate priority.`,
        `Third, ${tertiary} is still the point that may create delay if we ignore it.`,
        'The best close here is one practical next step and one person responsible for it.',
      ],
    ];
    return uniqueStrings(variants[variant] || variants[0] || []).slice(0, 5);
  }

  const profileLines = rotatedFacts.slice(0, 2);
  const genericVariants = [
    [
      `In this ${contextInfo.scenario}, the main focus is ${combinedFocus}.`,
      `The first point is the progress made so far on ${primary}.`,
      `The next point is ${secondary}, where the room still needs one clearer detail.`,
      `The biggest open risk is ${tertiary}, because that is the point everyone still needs to clarify.`,
      ...profileLines,
      'Before we finish, we need one clear next step and the owner for it.',
    ],
    [
      `This ${contextInfo.scenario} is centred on ${combinedFocus}.`,
      `One important update is ${primary}.`,
      `Another is ${secondary}, where the listener still needs a more specific explanation.`,
      `The final theme is ${tertiary}, because that may affect the next decision.`,
      ...profileLines,
      'The conversation should end with one agreed action and a clear deadline.',
    ],
    [
      `The discussion is about ${combinedFocus}.`,
      `First, we need to understand the latest progress on ${primary}.`,
      `Second, the speaker touches on ${secondary} without going into enough detail.`,
      `Third, ${tertiary} still sounds like the biggest unresolved point.`,
      ...profileLines,
      'Before the meeting ends, the team needs one next step and one responsible owner.',
    ],
  ];

  return uniqueStrings(genericVariants[variant] || genericVariants[0] || []).slice(0, 5);
}

function buildAskAfterSampleQuestion(contextInfo: ReturnType<typeof inferConversationContext>, suggestedFocus: string, offset: number) {
  const focus = stripLeadingArticle(suggestedFocus || contextInfo.focusAreas[1] || contextInfo.focusAreas[0] || contextInfo.focus || 'that point');
  const variant = Math.abs(offset) % 3;

  if (contextInfo.scenario === 'performance review') {
    const questions = [
      `You mentioned ${focus}. Could you say a bit more about the impact there?`,
      `You mentioned ${focus}. Could you explain what changed there during the last review period?`,
      `You mentioned ${focus}. Could you be a little more specific about the result there?`,
    ];
    return questions[variant] || questions[0] || '';
  }

  if (contextInfo.scenario === 'sprint review') {
    const questions = [
      `You mentioned ${focus}. Could you explain what still needs to happen there before the release?`,
      `You mentioned ${focus}. Could you talk us through the next step there before rollout?`,
      `You mentioned ${focus}. Could you be a little more specific about the remaining risk there?`,
    ];
    return questions[variant] || questions[0] || '';
  }

  if (contextInfo.scenario === 'standup') {
    const questions = [
      `You mentioned ${focus}. Could you say a bit more about what is blocking it today?`,
      `You mentioned ${focus}. Could you talk us through what needs to happen next?`,
      `You mentioned ${focus}. Could you be a little more specific about the blocker there?`,
    ];
    return questions[variant] || questions[0] || '';
  }

  const generic = [
    `You mentioned ${focus}. Could you say a bit more about that point?`,
    `You mentioned ${focus}. Could you talk us through that in more detail?`,
    `You mentioned ${focus}. Could you be a little more specific about that?`,
  ];
  return generic[variant] || generic[0] || '';
}

function buildAskAfterCoachingTip(contextInfo: ReturnType<typeof inferConversationContext>) {
  if (contextInfo.scenario === 'sprint review') {
    return 'Anchor the question in the update first, then ask for the missing risk, owner, or next-step detail.';
  }

  if (contextInfo.scenario === 'performance review') {
    return 'Refer to one concrete point from the review first, then ask for the missing impact, support, or next-step detail.';
  }

  return 'Use one short reference to the talk first, then ask for the missing detail with a clear follow-up question.';
}

function normalizeAskAfterText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeAskAfter(value: string) {
  return normalizeAskAfterText(value).split(' ').filter((token) => token.length >= 2);
}

function getTokenOverlapRatio(left: string, right: string) {
  const leftTokens = new Set(tokenizeAskAfter(left));
  const rightTokens = new Set(tokenizeAskAfter(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function looksMeaningfulDetail(value: string) {
  const raw = normalizeWhitespace(value);
  if (!raw) {
    return false;
  }

  if (/(.)\1{4,}/i.test(raw)) {
    return false;
  }

  const normalized = normalizeAskAfterText(raw);
  const compact = normalized.replace(/\s+/g, '');
  if (!compact) {
    return false;
  }

  const uniqueCharacters = new Set(compact.split(''));
  if (compact.length >= 6 && uniqueCharacters.size <= 2) {
    return false;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) {
    return false;
  }

  if (tokens.length === 1) {
    const token = tokens[0] || '';
    if (token.length < 3) {
      return false;
    }

    if (!/[aeiou]/i.test(token) && token.length >= 5) {
      return false;
    }
  }

  return true;
}

function normalizeAskAfterSpeechLines(value: unknown): AskAfterSpeechLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const lines: AskAfterSpeechLine[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = normalizeWhitespace(item);
      if (text) {
        lines.push(text);
      }
      continue;
    }

    const record = asRecord(item);
    const speaker = normalizeWhitespace(asString(record.speaker));
    const text = normalizeWhitespace(asString(record.text));
    if (speaker || text) {
      lines.push({
        ...(speaker ? { speaker } : {}),
        ...(text ? { text } : {}),
      });
    }
  }

  return lines;
}

function normalizeAskAfterBrief(value: unknown, fallback: AskAfterBrief): AskAfterBrief {
  const record = asRecord(value);
  const speechLines = normalizeAskAfterSpeechLines(record.speechLines);
  const sampleQuestion = normalizeWhitespace(asString(record.sampleQuestion, fallback.sampleQuestion));
  const suggestedFocus = normalizeWhitespace(asString(record.suggestedFocus, fallback.suggestedFocus || ''));
  const coachingTip = normalizeWhitespace(asString(record.coachingTip, fallback.coachingTip));
  const generatorMode = normalizeWhitespace(asString(record.generatorMode, fallback.generatorMode));
  const providerError = normalizeWhitespace(asString(record.providerError, fallback.providerError || ''));

  return {
    speechLines: speechLines.length ? speechLines : fallback.speechLines,
    sampleQuestion: sampleQuestion || fallback.sampleQuestion,
    suggestedFocus: suggestedFocus || fallback.suggestedFocus,
    coachingTip: coachingTip || fallback.coachingTip,
    generatorMode: generatorMode || fallback.generatorMode,
    ...(providerError ? { providerError } : fallback.providerError ? { providerError: fallback.providerError } : {}),
  };
}

export class PracticeService {
  constructor(private readonly contentService: ContentService) {}

  private async getPracticeConfig() {
    const content = await this.contentService.getContent();
    return asRecord(content.meta.practice);
  }

  private selectProfile(config: Record<string, unknown>, context: string) {
    const profiles = asRecord(config.clarifyProfiles);
    const keys = Object.keys(profiles);
    const key = detectPracticeProfileKey(context, keys);
    return asRecord(profiles[key] ?? profiles.general ?? {});
  }

  private buildClarifyFallback(config: Record<string, unknown>, context: string, offset: number, providerError: string): ClarifyExercise {
    const profile = this.selectProfile(config, context);
    const exercises = Array.isArray(profile.clarifyExercises) ? profile.clarifyExercises.map((item) => asRecord(item)) : [];
    const picked = exercises.length ? exercises[Math.abs(offset) % exercises.length] : asRecord({});
    const contextInfo = inferConversationContext(context, asString(profile.topic, 'the current project'));
    const fragment = asString(picked.fragment, `The update for ${contextInfo.focus} needs ... before sign-off.`);
    return {
      prompt: fragment,
      expectedQuestion: asString(picked.expectedQuestion, 'Sorry, the update needs WHAT?'),
      target: asString(picked.target, 'WHAT'),
      focus: asString(picked.focus, contextInfo.focus),
      coachingTip: `Listen for the missing detail in ${contextInfo.focus} and ask one polite WH-question.`,
      generatorMode: 'content-fallback',
      providerError,
    };
  }

  private buildAskAfterFallback(config: Record<string, unknown>, context: string, offset: number, providerError: string): AskAfterBrief {
    const profile = this.selectProfile(config, context);
    const talkFacts = asStringArray(profile.talkFacts);
    const rotateBy = talkFacts.length ? Math.abs(offset) % talkFacts.length : 0;
    const rotatedFacts = talkFacts.length ? talkFacts.slice(rotateBy).concat(talkFacts.slice(0, rotateBy)) : [];
    const contextInfo = inferConversationContext(context, asString(profile.topic, 'the current project'));
    const suggestedFocus = pickAskAfterFocus(contextInfo, rotatedFacts, offset);

    return {
      speechLines: buildAskAfterSpeechLines(contextInfo, rotatedFacts, offset),
      sampleQuestion: buildAskAfterSampleQuestion(contextInfo, suggestedFocus, offset),
      suggestedFocus,
      coachingTip: buildAskAfterCoachingTip(contextInfo),
      generatorMode: 'content-fallback',
      providerError,
    };
  }

  async generateClarify(context: string, offset = 0) {
    const config = await this.getPracticeConfig();
    const contextInfo = inferConversationContext(context, 'the current project');
    try {
      return await withChatProvider(env.LLM_TEXT_PROVIDER, (provider) =>
        provider.generateClarify({
          systemPrompt: 'Generate a workplace English clarification exercise with keys prompt, expectedQuestion, target, focus, coachingTip, generatorMode.',
          prompt: [
            `Learner context: ${context || 'Not provided'}`,
            `Conversation scenario: ${contextInfo.scenario}`,
            `Primary focus: ${contextInfo.subject}`,
            `Learner role: ${contextInfo.learnerRole}`,
            `Counterpart role: ${contextInfo.counterpartRole}`,
            `Create one missing-detail exercise. Offset: ${offset}.`,
          ].join('\n'),
          responseShape: 'clarify',
        }),
      );
    } catch (error) {
      return this.buildClarifyFallback(config, context, offset, error instanceof Error ? error.message : String(error));
    }
  }

  async checkClarify(input: { userQuestion: string; expectedQuestion: string; target?: string; focus?: string; acceptedAnswers?: string[] }) {
    const config = await this.getPracticeConfig();
    const feedback = asRecord(config.clarifyFeedback);
    const normalizedUser = normalizeClarifyQuestion(input.userQuestion);
    const expectedAnswers = [input.expectedQuestion, ...asStringArray(input.acceptedAnswers)].filter((item) => String(item || '').trim().length > 0);

    if (expectedAnswers.length) {
      const accepted = expectedAnswers.some((candidate) => normalizeClarifyQuestion(candidate) === normalizedUser);
      return {
        accepted,
        feedback: accepted
          ? getNestedString(feedback, ['accepted'])
          : getNestedString(feedback, ['mismatch']) || getNestedString(feedback, ['missingFocus']),
      };
    }

    const normalizedTarget = normalizeClarifyQuestion(input.target || '');
    const accepted = normalizedTarget.length > 0 && normalizedUser.includes(normalizedTarget);
    const hasFocus = normalizeClarifyQuestion(input.focus || '')
      .split(' ')
      .filter((token) => token.length >= 3)
      .some((token) => normalizedUser.includes(token));
    const hasPoliteOpener = /\bsorry\b/.test(normalizedUser);

    return {
      accepted,
      feedback: accepted
        ? getNestedString(feedback, ['accepted'])
        : normalizedTarget && !normalizedUser.includes(normalizedTarget)
          ? formatTemplate(getNestedString(feedback, ['wrongTarget']), { target: input.target || 'WHAT' })
          : !hasFocus
            ? getNestedString(feedback, ['missingFocus'])
            : !hasPoliteOpener
              ? getNestedString(feedback, ['missingPolite'])
              : getNestedString(feedback, ['mismatch']) || getNestedString(feedback, ['missingFocus']),
    };
  }

  async generateAskAfter(context: string, offset = 0) {
    const config = await this.getPracticeConfig();
    const contextInfo = inferConversationContext(context, 'the current project');
    const fallback = this.buildAskAfterFallback(config, context, offset, '');
    try {
      const generated = await withChatProvider(env.LLM_TEXT_PROVIDER, (provider) =>
        provider.generateAskAfter({
          systemPrompt: 'Generate a short workplace monologue with keys speechLines, sampleQuestion, suggestedFocus, coachingTip, generatorMode. Return one short spoken update, not a dialogue, vary the details on repeated generations, and keep the follow-up question natural for spoken business English.',
          prompt: [
            `Learner context: ${context || 'Not provided'}`,
            `Conversation scenario: ${contextInfo.scenario}`,
            `Primary focus: ${contextInfo.subject}`,
            `Learner role: ${contextInfo.learnerRole}`,
            `Counterpart role: ${contextInfo.counterpartRole}`,
            `Create a short workplace talk for follow-up question practice. Offset: ${offset}.`,
          ].join('\n'),
          responseShape: 'ask-after',
        }),
      );
      return normalizeAskAfterBrief(generated, fallback);
    } catch (error) {
      return normalizeAskAfterBrief(
        this.buildAskAfterFallback(config, context, offset, error instanceof Error ? error.message : String(error)),
        fallback,
      );
    }
  }

  async checkAskAfter(input: string | { question: string; expectedQuestion?: string; detail?: string; contextPhrase?: string; followUpPhrase?: string }) {
    const config = await this.getPracticeConfig();
    const feedback = asRecord(config.askAfterFeedback);
    const payload = typeof input === 'string' ? { question: input } : asRecord(input);
    const question = normalizeWhitespace(asString(payload.question));
    const expectedQuestion = normalizeWhitespace(asString(payload.expectedQuestion));
    const detail = normalizeWhitespace(asString(payload.detail));

    const hasQuestionMark = /\?/.test(question);
    const hasQuestionLead = /could you|can you|would you|what|when|why|who|which|how/i.test(question);
    const hasContext = /(you commented|you spoke about|you referred to|you quoted a figure of|you made the point that|you said something about|i think i misunderstood you|there is one thing i m not clear about|you didn t mention|you mentioned|you highlighted|i may have missed the point about|i wasn't fully clear on)/i.test(question);
    const hasFollow = /(explain|run us through|specific|tell us how|elaborate|say a bit more|go over|talk us through)/i.test(question);
    const detailAccepted = !detail || looksMeaningfulDetail(detail);
    const overlap = expectedQuestion ? getTokenOverlapRatio(question, expectedQuestion) : 1;
    const onTrack = !expectedQuestion || overlap >= 0.45;
    const accepted = hasQuestionMark && hasQuestionLead && hasContext && hasFollow && detailAccepted && onTrack;

    return {
      accepted,
      feedback: accepted
        ? getNestedString(feedback, ['accepted'])
        : !detailAccepted
          ? getNestedString(feedback, ['unclearDetail']) || 'Use one real detail from the talk instead of filler or repeated letters.'
          : !hasContext
            ? getNestedString(feedback, ['missingContext'])
            : !hasFollow
              ? getNestedString(feedback, ['missingFollow'])
              : !onTrack
                ? getNestedString(feedback, ['offTrack']) || 'Keep the question closer to the selected lead-in and follow-up phrase so it stays clear and natural.'
                : getNestedString(feedback, ['missingQuestion']),
    };
  }
}



