function normalizeText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeQuestion(value: string) {
  return normalizeText(value).toLowerCase().replace(/[?.!]+$/g, '');
}

function getQuestionLead(value: string) {
  const normalized = normalizeQuestion(value);
  const compound = normalized.match(/^(how\s+(?:long|often|far|much|many|soon|fast))\b/);
  if (compound?.[1]) {
    return compound[1];
  }
  return normalized.match(/^(who|whom|whose|what|which|where|when|why|how)\b/)?.[1] || '';
}

export function hasClientQuestionFormationGrammar(value: string) {
  const normalized = normalizeQuestion(value);
  if (!normalized) {
    return false;
  }

  const questionLead = getQuestionLead(normalized);
  if (!questionLead) {
    return false;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const leadWords = questionLead.split(/\s+/).length;
  const auxiliaries = new Set(['will', 'would', 'can', 'could', 'should', 'did', 'does', 'do', 'is', 'are', 'was', 'were', 'has', 'have', 'had']);
  const objectQuestionLeads = new Set(['who', 'whom', 'what', 'where', 'when', 'why', 'how', 'how long', 'how often', 'how far', 'how soon', 'how fast']);
  const flexibleNounPhraseLeads = new Set(['whose', 'which', 'how much', 'how many']);
  const firstAfterLead = tokens[leadWords] || '';
  const secondAfterLead = tokens[leadWords + 1] || '';
  const thirdAfterLead = tokens[leadWords + 2] || '';

  if (objectQuestionLeads.has(questionLead) && !auxiliaries.has(firstAfterLead)) {
    return false;
  }

  if (flexibleNounPhraseLeads.has(questionLead) && !auxiliaries.has(firstAfterLead) && !auxiliaries.has(secondAfterLead) && !auxiliaries.has(thirdAfterLead)) {
    return false;
  }

  const modalAuxiliaries = new Set(['will', 'would', 'can', 'could', 'should', 'do', 'does', 'did', 'has', 'have', 'had']);
  const modalIndex = tokens.findIndex((token) => modalAuxiliaries.has(token));
  if (modalIndex >= 0 && tokens.slice(modalIndex + 1).some((token) => token.endsWith('ed') && token.length > 4)) {
    return false;
  }

  return true;
}

export function checkQuestionFormationFallback(input: {
  userQuestion: string;
  whWord: string;
  expectedQuestion: string;
  acceptedQuestions?: string[];
}) {
  const user = normalizeQuestion(input.userQuestion);
  const expected = normalizeQuestion(input.expectedQuestion);
  const accepted = [expected, ...(input.acceptedQuestions || []).map(normalizeQuestion)].filter(Boolean);
  const exactOrClose = accepted.some((candidate) => user === candidate);
  const wh = normalizeText(input.whWord).toLowerCase();
  const acceptedLeads = accepted.map(getQuestionLead).filter(Boolean);
  const startsWithWh = wh ? user.startsWith(wh) || acceptedLeads.some((lead) => user.startsWith(lead)) : true;
  const grammatical = hasClientQuestionFormationGrammar(input.userQuestion)
    && accepted.some((candidate) => candidate.split(' ').some((token) => token.length > 4 && user.includes(token)));

  return {
    accepted: Boolean(startsWithWh && (exactOrClose || grammatical)),
    feedback: startsWithWh && (exactOrClose || grammatical)
      ? 'Correct. The question is grammatically clear and targets the hidden information.'
      : 'The grammar or meaning does not match the original sentence yet. Try keeping the question close to the visible words.',
  };
}
