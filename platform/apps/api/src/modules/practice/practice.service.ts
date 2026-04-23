import { env } from '../../config/env';
import type {
  AskAfterBrief,
  AskAfterSpeechLine,
  ClarifyExercise,
  QuestionFormationBlank,
  QuestionFormationExercise,
} from '@softskills/domain';
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

function limitWords(value: string, maxWords: number) {
  const words = normalizeWhitespace(value).split(' ').filter(Boolean);
  if (words.length <= maxWords) {
    return normalizeWhitespace(value);
  }

  return `${words.slice(0, maxWords).join(' ').replace(/[,.!?;:]+$/g, '')}.`;
}

function capitalizeFirst(value: string) {
  const next = normalizeWhitespace(value);
  if (!next) {
    return '';
  }

  return next.charAt(0).toUpperCase() + next.slice(1);
}

function normalizeSpeechTopic(context: string, fallback: string) {
  let topic = normalizeWhitespace(context || fallback || 'the current team update');

  topic = topic
    .replace(/^the\s+speech\s+is\s+about\s+/i, '')
    .replace(/^speech\s+is\s+about\s+/i, '')
    .replace(/^this\s+speech\s+is\s+about\s+/i, '')
    .replace(/^i\s+want\s+to\s+hear\s+about\s+/i, '')
    .replace(/^i\s+need\s+to\s+listen\s+to\s+/i, '')
    .replace(/^my\s+manager\s+is\s+telling\s+(us|me)\s+about\s+/i, '')
    .replace(/^the\s+manager\s+is\s+telling\s+(us|me)\s+about\s+/i, '')
    .replace(/^someone\s+is\s+telling\s+(us|me)\s+about\s+/i, '')
    .replace(/^the\s+person\s+is\s+(talking|speaking)\s+about\s+/i, '')
    .replace(/^a\s+person\s+is\s+(talking|speaking)\s+about\s+/i, '');

  topic = topic
    .replace(/\bhis\s+new\s+metric\b/gi, 'the new metric')
    .replace(/\bher\s+new\s+metric\b/gi, 'the new metric')
    .replace(/\bhis\s+/gi, 'the ')
    .replace(/\bher\s+/gi, 'the ')
    .replace(/\bmy\s+/gi, 'the ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/g, '');

  return topic || fallback || 'the current team update';
}

function buildLikelyProfessionalSpeech(topic: string, offset: number) {
  const cleanTopic = normalizeSpeechTopic(topic, 'the current team update');
  const variant = Math.abs(offset) % 3;
  const topicSentence = /^(the|a|an)\s+/i.test(cleanTopic) ? cleanTopic : `the ${cleanTopic}`;

  const variants = [
    `Today I want to talk about ${topicSentence}. The goal is to help everyone understand what will change, why it matters, and how we should use it in our day-to-day work. It should give us a clearer view of progress, make planning conversations more concrete, and help us spot bottlenecks earlier. We will review it together over the next few weeks, learn from the first results, and adjust the approach if it creates confusion or the wrong incentives.`,
    `I would like to give a quick update on ${topicSentence}. This is intended to make our conversations more practical and evidence-based, especially when we discuss progress, priorities, and delivery risks. It is not meant to add pressure or create another reporting burden. The important thing is that we use it consistently, look at the trend over time, and talk openly about what the data is telling us.`,
    `The main point today is ${topicSentence}. I want us to see it as a tool for better teamwork, not just another number. If we use it well, it can help us understand where work is flowing smoothly, where it is getting stuck, and where we may need support. Let us start with a simple version, review it regularly, and improve it based on what we learn together.`,
  ];

  return limitWords(capitalizeFirst(variants[variant] || variants[0] || ''), 100);
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
  rawContext = '',
) {
  const speechTopic = normalizeSpeechTopic(rawContext, contextInfo.subject || contextInfo.focus || 'the current team update');
  if (speechTopic) {
    return [buildLikelyProfessionalSpeech(speechTopic, offset)];
  }

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
  if (typeof value === 'string') {
    const text = limitWords(normalizeWhitespace(value), 100);
    return text ? [text] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const lines: AskAfterSpeechLine[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = limitWords(normalizeWhitespace(item), 100);
      if (text) {
        lines.push(text);
      }
      continue;
    }

    const record = asRecord(item);
    const speaker = normalizeWhitespace(asString(record.speaker));
    const text = limitWords(normalizeWhitespace(asString(record.text)), 100);
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
  const rawSpeechLines = normalizeAskAfterSpeechLines(record.speechLines);
  const speechText = rawSpeechLines
    .map((line) => (typeof line === 'string' ? line : normalizeWhitespace(asString(line.text))))
    .filter(Boolean)
    .join(' ');
  const speechLines = speechText ? [limitWords(speechText, 100)] : [];
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

const defaultQuestionFormationDeck: QuestionFormationExercise[] = [
  {
    sentence: 'Stakeholders will review return on investment at the end of the year.',
    blanks: [
      {
        id: 'stakeholders',
        index: 1,
        answer: 'Stakeholders',
        whWord: 'Who',
        expectedQuestion: 'Who will review return on investment at the end of the year?',
      },
      {
        id: 'return-on-investment',
        index: 2,
        answer: 'return on investment',
        whWord: 'What',
        expectedQuestion: 'What will stakeholders review at the end of the year?',
      },
      {
        id: 'end-of-year',
        index: 3,
        answer: 'end of the year',
        whWord: 'When',
        expectedQuestion: 'When will stakeholders review return on investment?',
      },
    ],
    coachingTip: 'Ask about the hidden detail with the right WH word, but keep the rest of the sentence grammar intact.',
    generatorMode: 'content-fallback',
  },
  {
    sentence: 'The backend team fixed six API defects in staging yesterday.',
    blanks: [
      {
        id: 'backend-team',
        index: 1,
        answer: 'backend team',
        whWord: 'Who',
        expectedQuestion: 'Who fixed six API defects in staging yesterday?',
      },
      {
        id: 'api-defects',
        index: 2,
        answer: 'six API defects',
        whWord: 'What',
        expectedQuestion: 'What did the backend team fix in staging yesterday?',
      },
      {
        id: 'staging',
        index: 3,
        answer: 'staging',
        whWord: 'Where',
        expectedQuestion: 'Where did the backend team fix six API defects yesterday?',
      },
    ],
    coachingTip: 'Use the auxiliary verb that fits the sentence tense: will, did, does, is, or are.',
    generatorMode: 'content-fallback',
  },
  {
    sentence: 'Two engineers will migrate customer logs to the new archive tonight.',
    blanks: [
      {
        id: 'two',
        index: 1,
        answer: 'Two',
        whWord: 'How many',
        expectedQuestion: 'How many engineers will migrate customer logs to the new archive tonight?',
      },
      {
        id: 'customer-logs',
        index: 2,
        answer: 'customer logs',
        whWord: 'What',
        expectedQuestion: 'What will two engineers migrate to the new archive tonight?',
      },
      {
        id: 'tonight',
        index: 3,
        answer: 'tonight',
        whWord: 'When',
        expectedQuestion: 'When will two engineers migrate customer logs to the new archive?',
      },
    ],
    coachingTip: 'For numbers, use How many or How much and keep the noun after it.',
    generatorMode: 'content-fallback',
  },
  {
    sentence: 'The security review will take two hours in the main meeting room.',
    blanks: [
      {
        id: 'security-review',
        index: 1,
        answer: 'security review',
        whWord: 'What',
        expectedQuestion: 'What will take two hours in the main meeting room?',
      },
      {
        id: 'two-hours',
        index: 2,
        answer: 'two hours',
        whWord: 'How long',
        expectedQuestion: 'How long will the security review take in the main meeting room?',
      },
      {
        id: 'meeting-room',
        index: 3,
        answer: 'main meeting room',
        whWord: 'Where',
        expectedQuestion: 'Where will the security review take two hours?',
      },
    ],
    coachingTip: 'When asking about duration, use How long and move the auxiliary before the subject.',
    generatorMode: 'content-fallback',
  },
  {
    sentence: 'Maya will demo the analytics dashboard for product managers on Friday.',
    blanks: [
      {
        id: 'maya',
        index: 1,
        answer: 'Maya',
        whWord: 'Who',
        expectedQuestion: 'Who will demo the analytics dashboard for product managers on Friday?',
      },
      {
        id: 'analytics-dashboard',
        index: 2,
        answer: 'analytics dashboard',
        whWord: 'What',
        expectedQuestion: 'What will Maya demo for product managers on Friday?',
      },
      {
        id: 'friday',
        index: 3,
        answer: 'Friday',
        whWord: 'When',
        expectedQuestion: 'When will Maya demo the analytics dashboard for product managers?',
      },
    ],
    coachingTip: 'Keep names, objects, and time phrases in the right position when you form the question.',
    generatorMode: 'content-fallback',
  },
];

const proceduralQuestionFormationSubjects = [
  'The product owner',
  'Three QA engineers',
  'The DevOps team',
  'Security analysts',
  'The data platform squad',
  'Customer success managers',
  'The release coordinator',
  'Two backend developers',
];

const proceduralQuestionFormationActions = [
  {
    verb: 'will validate',
    object: 'the billing API',
    place: 'staging',
    time: 'tomorrow morning',
    objectQuestion: 'What will {subject} validate in {place} {time}?',
  },
  {
    verb: 'will present',
    object: 'the throughput metric',
    place: 'the sprint review',
    time: 'on Thursday',
    objectQuestion: 'What will {subject} present at {place} {time}?',
  },
  {
    verb: 'will deploy',
    object: 'the search fix',
    place: 'production',
    time: 'after approval',
    objectQuestion: 'What will {subject} deploy to {place} {time}?',
  },
  {
    verb: 'will test',
    object: 'the onboarding flow',
    place: 'the mobile build',
    time: 'this afternoon',
    objectQuestion: 'What will {subject} test in {place} {time}?',
  },
  {
    verb: 'will review',
    object: 'access logs',
    place: 'the security channel',
    time: 'before release',
    objectQuestion: 'What will {subject} review in {place} {time}?',
  },
  {
    verb: 'will migrate',
    object: 'customer reports',
    place: 'the data warehouse',
    time: 'next week',
    objectQuestion: 'What will {subject} migrate to {place} {time}?',
  },
];

function countWords(value: string) {
  return normalizeWhitespace(value).split(/\s+/).filter(Boolean).length;
}

function normalizeQuestionFormationBlank(value: unknown, fallback: QuestionFormationBlank, index: number): QuestionFormationBlank {
  const record = asRecord(value);
  const answer = normalizeWhitespace(asString(record.answer, fallback.answer));
  const whWord = normalizeWhitespace(asString(record.whWord, fallback.whWord));
  const expectedQuestion = normalizeWhitespace(asString(record.expectedQuestion, fallback.expectedQuestion));
  const acceptedQuestions = asStringArray(record.acceptedQuestions)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);

  return {
    id: normalizeWhitespace(asString(record.id, fallback.id || `blank-${index}`)) || `blank-${index}`,
    index,
    answer: answer || fallback.answer,
    whWord: whWord || fallback.whWord,
    expectedQuestion: expectedQuestion || fallback.expectedQuestion,
    ...(acceptedQuestions.length ? { acceptedQuestions } : fallback.acceptedQuestions?.length ? { acceptedQuestions: fallback.acceptedQuestions } : {}),
  };
}

function normalizeQuestionFormationExercise(value: unknown, fallback: QuestionFormationExercise): QuestionFormationExercise {
  const record = asRecord(value);
  const sentence = normalizeWhitespace(asString(record.sentence, fallback.sentence)).replace(/[!?]+$/g, '.');
  const rawBlanks = Array.isArray(record.blanks) ? record.blanks : [];
  const blanks = fallback.blanks.map((fallbackBlank, index) => normalizeQuestionFormationBlank(rawBlanks[index], fallbackBlank, index + 1));
  const allAnswersExist = blanks.every((blank) => normalizeAskAfterText(sentence).includes(normalizeAskAfterText(blank.answer)));
  const safeSentence = sentence && countWords(sentence) <= 15 && allAnswersExist ? sentence : fallback.sentence;

  return {
    sentence: safeSentence,
    blanks: safeSentence === sentence ? blanks : fallback.blanks,
    coachingTip: normalizeWhitespace(asString(record.coachingTip, fallback.coachingTip)) || fallback.coachingTip,
    generatorMode: normalizeWhitespace(asString(record.generatorMode, fallback.generatorMode)) || fallback.generatorMode,
    providerError: normalizeWhitespace(asString(record.providerError, fallback.providerError || '')) || fallback.providerError,
  };
}

function buildProceduralQuestionFormation(offset: number): QuestionFormationExercise {
  const subject = proceduralQuestionFormationSubjects[Math.abs(offset) % proceduralQuestionFormationSubjects.length] || 'The engineering team';
  const action = proceduralQuestionFormationActions[Math.floor(Math.abs(offset) / proceduralQuestionFormationSubjects.length) % proceduralQuestionFormationActions.length] || proceduralQuestionFormationActions[0];
  const placePreposition = /\b(review|present)\b/i.test(action.verb) ? 'at' : /\b(migrate|deploy)\b/i.test(action.verb) ? 'to' : 'in';
  const sentence = `${subject} ${action.verb} ${action.object} ${placePreposition} ${action.place} ${action.time}.`;
  const compactSubject = subject.replace(/^the\s+/i, '');
  const subjectQuestion = `Who ${action.verb} ${action.object} ${placePreposition} ${action.place} ${action.time}?`;
  const objectQuestion = formatTemplate(action.objectQuestion, {
    subject: subject.toLowerCase(),
    place: action.place,
    time: action.time,
  });
  const timeQuestion = `When ${action.verb} ${compactSubject} ${action.object} ${placePreposition} ${action.place}?`;

  return {
    sentence,
    blanks: [
      {
        id: `subject-${offset}`,
        index: 1,
        answer: subject,
        whWord: 'Who',
        expectedQuestion: subjectQuestion,
        acceptedQuestions: [
          `Who ${action.verb} it?`,
          `Who ${action.verb} ${action.object}?`,
        ],
      },
      {
        id: `object-${offset}`,
        index: 2,
        answer: action.object,
        whWord: 'What',
        expectedQuestion: objectQuestion,
        acceptedQuestions: [
          `What ${action.verb} ${subject.toLowerCase()}?`,
          `What ${action.verb} ${compactSubject.toLowerCase()}?`,
        ],
      },
      {
        id: `time-${offset}`,
        index: 3,
        answer: action.time.replace(/^on\s+/i, ''),
        whWord: 'When',
        expectedQuestion: timeQuestion,
        acceptedQuestions: [
          `When ${action.verb} ${subject.toLowerCase()} it?`,
          `When ${action.verb} ${compactSubject.toLowerCase()} it?`,
        ],
      },
    ],
    coachingTip: 'Use the visible words first. A short correct WH question is enough.',
    generatorMode: 'procedural-fallback',
  };
}

function getQuestionFormationFallback(config: Record<string, unknown>, offset: number, providerError = ''): QuestionFormationExercise {
  const configuredDeck = Array.isArray(config.questionFormationDeck)
    ? config.questionFormationDeck.map((item) => asRecord(item))
    : [];
  const uniqueDeck = [...configuredDeck, ...defaultQuestionFormationDeck]
    .filter((item, index, source) => {
      const sentence = normalizeAskAfterText(asString(asRecord(item).sentence));
      return sentence && source.findIndex((candidate) => normalizeAskAfterText(asString(asRecord(candidate).sentence)) === sentence) === index;
    });
  const deckOffset = Math.abs(offset);
  const picked = deckOffset < uniqueDeck.length ? uniqueDeck[deckOffset] : buildProceduralQuestionFormation(deckOffset - uniqueDeck.length);
  const fallback = defaultQuestionFormationDeck[deckOffset % defaultQuestionFormationDeck.length] || defaultQuestionFormationDeck[0];
  const normalized = normalizeQuestionFormationExercise(picked, fallback);

  return {
    ...normalized,
    generatorMode: asString(asRecord(picked).generatorMode, 'content-fallback'),
    ...(providerError ? { providerError } : normalized.providerError ? { providerError: normalized.providerError } : {}),
  };
}

function startsWithWhWord(question: string, whWord: string) {
  const normalizedQuestion = normalizeAskAfterText(question);
  const normalizedWh = normalizeAskAfterText(whWord);
  return Boolean(normalizedWh) && (normalizedQuestion === normalizedWh || normalizedQuestion.startsWith(`${normalizedWh} `));
}

function containsAnswerLeak(question: string, answer: string) {
  const normalizedQuestion = normalizeAskAfterText(question);
  const answerTokens = normalizeAskAfterText(answer).split(' ').filter((token) => token.length >= 3);
  if (!answerTokens.length) {
    return false;
  }

  return answerTokens.every((token) => normalizedQuestion.includes(token));
}

function hasQuestionFormationGrammar(value: string) {
  const tokens = normalizeAskAfterText(value).split(' ').filter(Boolean);
  const didIndex = tokens.indexOf('did');
  if (didIndex >= 0) {
    const afterDid = tokens.slice(didIndex + 1);
    if (afterDid.some((token) => token.endsWith('ed') && token.length > 4)) {
      return false;
    }
  }

  return true;
}

function hasQuestionFormationPronounReference(userQuestion: string, expectedQuestion: string) {
  const userTokens = normalizeAskAfterText(userQuestion).split(' ').filter(Boolean);
  const expectedTokens = normalizeAskAfterText(expectedQuestion).split(' ').filter(Boolean);
  const pronouns = new Set(['it', 'this', 'that', 'them']);
  const auxiliaries = new Set(['who', 'what', 'where', 'when', 'why', 'how', 'long', 'many', 'much', 'will', 'would', 'can', 'could', 'should', 'do', 'does', 'did', 'is', 'are', 'was', 'were']);
  const hasPronoun = userTokens.some((token) => pronouns.has(token));
  const expectedVerb = expectedTokens.find((token) => token.length >= 4 && !auxiliaries.has(token));

  return Boolean(hasPronoun && expectedVerb && userTokens.includes(expectedVerb));
}

function toQuestionFormationVerbBase(value: string) {
  if (value.endsWith('ied') && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.endsWith('ed') && value.length > 4) {
    return value.slice(0, -2);
  }

  if (value.endsWith('es') && value.length > 4) {
    return value.slice(0, -2);
  }

  if (value.endsWith('s') && value.length > 3) {
    return value.slice(0, -1);
  }

  return value;
}

function hasQuestionFormationDidVerbReference(userQuestion: string, expectedQuestion: string) {
  const userTokens = normalizeAskAfterText(userQuestion).split(' ').filter(Boolean);
  const expectedTokens = normalizeAskAfterText(expectedQuestion).split(' ').filter(Boolean);
  const ignoredExpectedTokens = new Set(['who', 'what', 'where', 'when', 'why', 'how', 'long', 'many', 'much', 'will', 'would', 'can', 'could', 'should', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'it', 'this', 'that', 'them']);
  const didIndex = userTokens.indexOf('did');
  if (didIndex < 0) {
    return false;
  }

  const userVerb = userTokens[didIndex + 1] || '';
  const expectedDidIndex = expectedTokens.indexOf('did');
  const expectedVerb = expectedDidIndex >= 0
    ? expectedTokens[expectedDidIndex + 1] || ''
    : expectedTokens.find((token) => token.length >= 3 && !ignoredExpectedTokens.has(token)) || '';

  return Boolean(userVerb && expectedVerb && toQuestionFormationVerbBase(userVerb) === toQuestionFormationVerbBase(expectedVerb));
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
      speechLines: buildAskAfterSpeechLines(contextInfo, rotatedFacts, offset, context),
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
    const speechTopic = normalizeSpeechTopic(context, contextInfo.subject);
    const fallback = this.buildAskAfterFallback(config, context, offset, '');
    try {
      const generated = await withChatProvider(env.LLM_TEXT_PROVIDER, (provider) =>
        provider.generateAskAfter({
          systemPrompt: 'Generate a likely professional workplace speech for follow-up question practice. Return valid JSON with keys speechLines, sampleQuestion, suggestedFocus, coachingTip, generatorMode. speechLines must be an array containing one professional yet friendly paragraph string only. The speech must be no more than 100 words, must not be a dialogue, and must sound like what a professional would likely say about the topic.',
          prompt: [
            `Speech topic written by learner: ${speechTopic || context || 'Not provided'}`,
            `Core task: What is likely to be said by a professional when the speech is about ${speechTopic || contextInfo.subject}? Generate a professional yet friendly speech of no more than 100 words.`,
            `Conversation scenario: ${contextInfo.scenario}`,
            `Primary focus: ${contextInfo.subject}`,
            `Learner role: ${contextInfo.learnerRole}`,
            `Counterpart role: ${contextInfo.counterpartRole}`,
            `Also generate one natural follow-up sampleQuestion and one suggestedFocus from the speech. Offset: ${offset}.`,
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

  async generateQuestionFormation(context = '', offset = 0) {
    const config = await this.getPracticeConfig();
    const fallback = getQuestionFormationFallback(config, offset);
    const contextInfo = inferConversationContext(context, 'IT workplace communication');

    try {
      const generated = await withChatProvider(env.LLM_TEXT_PROVIDER, (provider) =>
        provider.generateQuestionFormation({
          systemPrompt: 'Generate one workplace IT English question-formation exercise. Return valid JSON with keys sentence, blanks, coachingTip, generatorMode. The sentence must be one short professional statement with no more than 15 words. It must contain exactly three meaningful answer spans suitable for WH questions. Each blank must include id, index, answer, whWord, expectedQuestion, and optional acceptedQuestions.',
          prompt: [
            `Learner context: ${context || 'General IT workplace practice'}`,
            `Conversation scenario: ${contextInfo.scenario}`,
            `Primary focus: ${contextInfo.subject}`,
            'Create one sentence only, not a dialogue.',
            'Use professional IT work context: sprint reviews, APIs, metrics, releases, defects, stakeholders, data, security, demos, or planning.',
            'The three blanks should cover different WH types when possible: Who, What, Where, When, How long, or How many.',
            'Choose answer spans that are visible meaningful words or phrases, never tiny function words.',
            'The sentence must still read naturally when each answer span is replaced with a numbered blank.',
            'Expected questions may be short and may use "it" when other information is hidden.',
            'Do not include more than 15 words in the sentence.',
            `Offset: ${offset}.`,
          ].join('\n'),
          responseShape: 'freeform',
        }),
      );

      return normalizeQuestionFormationExercise(generated, fallback);
    } catch (error) {
      return getQuestionFormationFallback(config, offset, error instanceof Error ? error.message : String(error));
    }
  }

  async checkQuestionFormation(input: {
    userQuestion: string;
    sentence: string;
    answer: string;
    whWord: string;
    expectedQuestion: string;
    acceptedQuestions?: string[];
  }) {
    const config = await this.getPracticeConfig();
    const feedback = asRecord(config.questionFormationFeedback);
    const userQuestion = normalizeWhitespace(input.userQuestion);
    const expectedQuestion = normalizeWhitespace(input.expectedQuestion);
    const acceptedQuestions = [expectedQuestion, ...asStringArray(input.acceptedQuestions)].filter(Boolean);
    const startsCorrectly = startsWithWhWord(userQuestion, input.whWord);
    const grammarAccepted = hasQuestionFormationGrammar(userQuestion);
    const leaksAnswer = containsAnswerLeak(userQuestion, input.answer);
    const overlap = acceptedQuestions.reduce((best, candidate) => Math.max(best, getTokenOverlapRatio(userQuestion, candidate)), 0);
    const pronounReferenceAccepted = acceptedQuestions.some((candidate) => hasQuestionFormationPronounReference(userQuestion, candidate));
    const didVerbReferenceAccepted = acceptedQuestions.some((candidate) => hasQuestionFormationDidVerbReference(userQuestion, candidate));
    const accepted = Boolean(userQuestion) && startsCorrectly && grammarAccepted && !leaksAnswer && (overlap >= 0.28 || pronounReferenceAccepted || didVerbReferenceAccepted);

    return {
      accepted,
      feedback: accepted
        ? getNestedString(feedback, ['accepted'], 'Correct. The question is grammatically clear and targets the hidden information.')
        : !userQuestion
          ? getNestedString(feedback, ['empty'], 'Type or dictate a question first.')
          : !startsCorrectly
            ? formatTemplate(getNestedString(feedback, ['wrongWhWord'], 'Use {whWord} to ask about this blank.'), { whWord: input.whWord || 'the right WH word' })
            : !grammarAccepted
              ? getNestedString(feedback, ['grammar'], 'Check the grammar. After "did", use the base verb form.')
              : leaksAnswer
                ? getNestedString(feedback, ['answerLeak'], 'Do not include the hidden answer in your question.')
                : getNestedString(feedback, ['mismatch'], 'The grammar or meaning does not match the original sentence yet. Try keeping the question close to the visible words.'),
    };
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



