export function normalizeWhitespace(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeLooseText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeLooseText(value: string) {
  return normalizeLooseText(value).split(' ').filter((token) => token.length >= 2);
}

export function getTokenOverlapRatio(left: string, right: string) {
  const leftTokens = new Set(tokenizeLooseText(left));
  const rightTokens = new Set(tokenizeLooseText(right));
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

export function looksMeaningfulUserInput(value: string) {
  const raw = normalizeWhitespace(value);
  if (!raw) {
    return false;
  }

  if (/(.)\1{4,}/i.test(raw)) {
    return false;
  }

  const normalized = normalizeLooseText(raw);
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

export function startsWithWhWord(question: string, whWord: string) {
  const normalizedQuestion = normalizeLooseText(question);
  const normalizedWh = normalizeLooseText(whWord);
  return Boolean(normalizedWh) && (normalizedQuestion === normalizedWh || normalizedQuestion.startsWith(`${normalizedWh} `));
}

export function containsAnswerLeak(question: string, answer: string) {
  const normalizedQuestion = normalizeLooseText(question);
  const answerTokens = normalizeLooseText(answer).split(' ').filter((token) => token.length >= 3);
  if (!answerTokens.length) {
    return false;
  }

  return answerTokens.every((token) => normalizedQuestion.includes(token));
}

export function toQuestionFormationVerbBase(value: string) {
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

export function hasQuestionFormationGrammar(value: string) {
  const tokens = normalizeLooseText(value).split(' ').filter(Boolean);
  const didIndex = tokens.indexOf('did');
  if (didIndex >= 0) {
    const afterDid = tokens.slice(didIndex + 1);
    if (afterDid.some((token) => token.endsWith('ed') && token.length > 4)) {
      return false;
    }
  }

  return true;
}

export function hasQuestionFormationPronounReference(userQuestion: string, expectedQuestion: string) {
  const userTokens = normalizeLooseText(userQuestion).split(' ').filter(Boolean);
  const expectedTokens = normalizeLooseText(expectedQuestion).split(' ').filter(Boolean);
  const pronouns = new Set(['it', 'this', 'that', 'them']);
  const auxiliaries = new Set(['who', 'what', 'where', 'when', 'why', 'how', 'long', 'many', 'much', 'will', 'would', 'can', 'could', 'should', 'do', 'does', 'did', 'is', 'are', 'was', 'were']);
  const hasPronoun = userTokens.some((token) => pronouns.has(token));
  const expectedVerb = expectedTokens.find((token) => token.length >= 4 && !auxiliaries.has(token));

  return Boolean(hasPronoun && expectedVerb && userTokens.includes(expectedVerb));
}

export function hasQuestionFormationDidVerbReference(userQuestion: string, expectedQuestion: string) {
  const userTokens = normalizeLooseText(userQuestion).split(' ').filter(Boolean);
  const expectedTokens = normalizeLooseText(expectedQuestion).split(' ').filter(Boolean);
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

function getQuestionFormationContentTokens(value: string) {
  return normalizeLooseText(value)
    .split(' ')
    .filter((token) => token.length >= 3);
}

export function hasQuestionFormationVisibleContextAlignment(
  userQuestion: string,
  sentence: string,
  answer: string,
  expectedQuestion: string,
) {
  const helperTokens = new Set([
    'who', 'whom', 'whose', 'what', 'which', 'where', 'when', 'why', 'how',
    'long', 'often', 'far', 'much', 'many', 'soon', 'fast',
    'do', 'does', 'did', 'is', 'are', 'was', 'were', 'will', 'would', 'can', 'could', 'should',
    'a', 'an', 'the', 'it', 'this', 'that', 'them', 'these', 'those',
    'in', 'on', 'at', 'by', 'for', 'to', 'of', 'with', 'from', 'about', 'after', 'before', 'during',
  ]);

  const normalizedSentence = normalizeLooseText(sentence);
  const normalizedAnswer = normalizeLooseText(answer);
  const visibleSentence = normalizedAnswer
    ? normalizedSentence.replace(normalizedAnswer, ' ')
    : normalizedSentence;

  const allowedTokens = new Set<string>();
  for (const token of [
    ...getQuestionFormationContentTokens(visibleSentence),
    ...getQuestionFormationContentTokens(expectedQuestion),
  ]) {
    allowedTokens.add(token);
    allowedTokens.add(toQuestionFormationVerbBase(token));
  }

  const userTokens = normalizeLooseText(userQuestion).split(' ').filter(Boolean);
  const suspiciousTokens = userTokens.filter((token) => {
    if (helperTokens.has(token)) {
      return false;
    }

    if (token.length < 4) {
      return false;
    }

    return !allowedTokens.has(token) && !allowedTokens.has(toQuestionFormationVerbBase(token));
  });

  return suspiciousTokens.length === 0;
}
