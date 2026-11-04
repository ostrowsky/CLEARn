import {
  containsAnswerLeak, getTokenOverlapRatio, hasQuestionFormationDidVerbReference,
  hasQuestionFormationGrammar, hasQuestionFormationPronounReference, hasQuestionFormationVisibleContextAlignment,
  looksMeaningfulUserInput, normalizeLooseText, normalizeWhitespace, startsWithWhWord,
} from './inputValidation';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

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

function normalizeAskAfterText(value: string) {
  return normalizeLooseText(value);
}

function looksMeaningfulDetail(value: string) {
  return looksMeaningfulUserInput(value);
}

function normalizeAskAfterPhraseForMatch(value: string) {
  return normalizeAskAfterText(value)
    .replace(/\bthat\b$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function askAfterPhraseMatchesQuestion(question: string, phrase: string, fallback: RegExp) {
  const normalizedQuestion = normalizeAskAfterText(question);
  if (!phrase.trim()) {
    return fallback.test(normalizedQuestion);
  }

  const normalizedPhrase = normalizeAskAfterPhraseForMatch(phrase.replace(/\.\.\./g, ''));
  if (!normalizedPhrase) {
    return fallback.test(normalizedQuestion);
  }

  return normalizedQuestion.includes(normalizedPhrase);
}

function startsWithAcceptedQuestionLead(userQuestion: string, acceptedQuestion: string) {
  const acceptedTokens = normalizeLooseText(acceptedQuestion).split(' ').filter(Boolean);
  const first = acceptedTokens[0] || '';
  const second = acceptedTokens[1] || '';
  const lead = first === 'how' && ['long', 'often', 'far', 'much', 'many', 'soon', 'fast'].includes(second)
    ? `${first} ${second}`
    : first;

  return startsWithWhWord(userQuestion, lead);
}

export function checkQuestionFormationAnswer(input: {
  userQuestion: string;
  sentence: string;
  answer: string;
  whWord: string;
  expectedQuestion: string;
  acceptedQuestions?: string[];
}, feedback: Record<string, unknown> = {}) {
  const userQuestion = normalizeWhitespace(input.userQuestion);
  const expectedQuestion = normalizeWhitespace(input.expectedQuestion);
  const acceptedQuestions = [expectedQuestion, ...asStringArray(input.acceptedQuestions)].filter(Boolean);
  const exactAccepted = acceptedQuestions.some((candidate) => normalizeLooseText(candidate) === normalizeLooseText(userQuestion));
  const startsCorrectly = startsWithWhWord(userQuestion, input.whWord)
    || acceptedQuestions.some((candidate) => startsWithAcceptedQuestionLead(userQuestion, candidate));
  const grammarAccepted = exactAccepted || hasQuestionFormationGrammar(userQuestion);
  const leaksAnswer = containsAnswerLeak(userQuestion, input.answer);
  const overlap = acceptedQuestions.reduce((best, candidate) => Math.max(best, getTokenOverlapRatio(userQuestion, candidate)), 0);
  const pronounReferenceAccepted = acceptedQuestions.some((candidate) => hasQuestionFormationPronounReference(userQuestion, candidate));
  const didVerbReferenceAccepted = acceptedQuestions.some((candidate) => hasQuestionFormationDidVerbReference(userQuestion, candidate));
  const visibleContextAccepted = acceptedQuestions.some((candidate) =>
    hasQuestionFormationVisibleContextAlignment(userQuestion, input.sentence, input.answer, candidate),
  );
  const accepted = Boolean(userQuestion)
    && startsCorrectly
    && grammarAccepted
    && !leaksAnswer
    && visibleContextAccepted
    && (overlap >= 0.28 || pronounReferenceAccepted || didVerbReferenceAccepted);

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
              : !visibleContextAccepted
                ? getNestedString(feedback, ['mismatch'], 'The grammar or meaning does not match the original sentence yet. Try keeping the question close to the visible words.')
              : getNestedString(feedback, ['mismatch'], 'The grammar or meaning does not match the original sentence yet. Try keeping the question close to the visible words.'),
  };
}

export function checkAskAfterAnswer(input: string | { question: string; expectedQuestion?: string; detail?: string; contextPhrase?: string; followUpPhrase?: string }, feedback: Record<string, unknown> = {}) {
  const payload = typeof input === 'string' ? { question: input } : asRecord(input);
  const question = normalizeWhitespace(asString(payload.question));
  const expectedQuestion = normalizeWhitespace(asString(payload.expectedQuestion));
  const detail = normalizeWhitespace(asString(payload.detail));

  const hasQuestionMark = /\?/.test(question);
  const hasQuestionLead = /could you|can you|would you|what|when|why|who|which|how/i.test(question);
  const contextPhrase = normalizeWhitespace(asString(payload.contextPhrase));
  const followUpPhrase = normalizeWhitespace(asString(payload.followUpPhrase));
  const hasContext = askAfterPhraseMatchesQuestion(
    question,
    contextPhrase,
    /(you commented|you spoke about|you referred to|you quoted a figure of|you made the point that|you said something about|i think i misunderstood you|there is one thing i m not clear about|there is one point i m not clear about|you didn t mention|you mentioned|you highlighted|i may have missed the point about|i wasn't fully clear on)/i,
  );
  const hasFollow = askAfterPhraseMatchesQuestion(
    question,
    followUpPhrase,
    /(explain|run us through|specific|tell us how|elaborate|say a bit more|go over|talk us through)/i,
  );
  const meaningfulQuestion = looksMeaningfulUserInput(question);
  const detailAccepted = !detail || looksMeaningfulDetail(detail);
  const overlap = expectedQuestion ? getTokenOverlapRatio(question, expectedQuestion) : 1;
  const onTrack = !expectedQuestion || overlap >= 0.45;
  const usesPhraseBankStructure = Boolean(contextPhrase || followUpPhrase);
  const selectedPhraseStructureAccepted = usesPhraseBankStructure && hasQuestionMark && hasQuestionLead;
  const freeformStructureAccepted = hasQuestionMark && hasQuestionLead && hasContext && hasFollow && onTrack;
  const accepted = meaningfulQuestion && detailAccepted && (selectedPhraseStructureAccepted || freeformStructureAccepted);

  return {
    accepted,
    feedback: accepted
      ? getNestedString(feedback, ['accepted'])
      : !meaningfulQuestion
        ? getNestedString(feedback, ['missingQuestion'])
        : !detailAccepted
        ? getNestedString(feedback, ['unclearDetail']) || 'Use one real detail from the talk instead of filler or repeated letters.'
        : !usesPhraseBankStructure && !hasContext
          ? getNestedString(feedback, ['missingContext'])
          : !usesPhraseBankStructure && !hasFollow
            ? getNestedString(feedback, ['missingFollow'])
            : !usesPhraseBankStructure && !onTrack
              ? getNestedString(feedback, ['offTrack']) || 'Keep the question closer to the selected lead-in and follow-up phrase so it stays clear and natural.'
              : getNestedString(feedback, ['missingQuestion']),
  };
}
