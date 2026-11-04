import { looksMeaningfulUserInput } from './inputValidation';

// Shared deterministic clarification validation for the API and browser fallback.

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

export function checkClarifyAnswer(input: { userQuestion: string; expectedQuestion: string; target?: string; focus?: string; acceptedAnswers?: string[] }, feedback: Record<string, unknown> = {}) {
  if (!looksMeaningfulUserInput(input.userQuestion)) {
    return {
      accepted: false,
      feedback: getNestedString(feedback, ['mismatch']) || getNestedString(feedback, ['missingFocus']),
    };
  }
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
