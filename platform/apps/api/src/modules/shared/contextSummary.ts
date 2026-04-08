function normalizeWhitespace(value: string) {
  return String(value || '')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTopicCandidate(value: string) {
  let candidate = normalizeWhitespace(value)
    .replace(/^[,;:.-]+\s*/, '')
    .replace(/[.?!]+$/, '')
    .trim();

  if (!candidate) {
    return '';
  }

  const keywordMatch = candidate.match(/\b(sprint review|performance review|review|meeting|conversation|presentation|negotiation|interview|standup|demo|retro|rollout|release|roadmap|dashboard|migration|billing service|api stability)\b/i);
  if (keywordMatch && typeof keywordMatch.index === 'number' && keywordMatch.index > 0) {
    candidate = candidate.slice(keywordMatch.index).trim();
  }

  if (/^(a|an)\s+/i.test(candidate) && /\b(review|meeting|conversation|presentation|negotiation|interview|standup|demo|retro|rollout|release)\b/i.test(candidate)) {
    candidate = candidate.replace(/^(a|an)\s+/i, 'the ');
  }

  if (
    candidate &&
    !/^(the|this|that|these|those|your|our|my|his|her|their|a|an)\b/i.test(candidate) &&
    candidate.split(' ').length >= 3
  ) {
    candidate = `the ${candidate}`;
  }

  if (candidate.length > 120) {
    candidate = `${candidate.slice(0, 117).trimEnd()}...`;
  }

  return candidate;
}

export function distillContextTopic(context: string, fallback: string) {
  const clean = normalizeWhitespace(context);
  if (!clean) {
    return fallback;
  }

  const patterns: RegExp[] = [
    /\bpreparing for\s+(.+)$/i,
    /\bpreparing\s+(?:a|an|the)\s+(.+)$/i,
    /\bgetting ready for\s+(.+)$/i,
    /\bworking on\s+(.+)$/i,
    /\bfocused on\s+(.+)$/i,
    /\bleading\s+(.+)$/i,
    /\brunning\s+(.+)$/i,
    /\bpresenting\s+(.+)$/i,
    /\babout\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1]) {
      const candidate = cleanTopicCandidate(match[1]);
      if (candidate) {
        return candidate;
      }
    }
  }

  const directCandidate = cleanTopicCandidate(clean);
  return directCandidate || fallback;
}

export function inferConversationScenario(context: string, fallback = 'meeting') {
  const clean = normalizeWhitespace(context).toLowerCase();
  if (!clean) {
    return fallback;
  }

  const checks: Array<[string, RegExp]> = [
    ['performance review', /\bperformance review\b/],
    ['sprint review', /\bsprint review\b/],
    ['one-to-one', /\b(one[- ]to[- ]one|1:1|1 to 1)\b/],
    ['interview', /\binterview|interviewing\b/],
    ['standup', /\bstandup\b/],
    ['retrospective', /\b(retro|retrospective)\b/],
    ['demo', /\bdemo\b/],
    ['presentation', /\bpresentation|presenting\b/],
    ['negotiation', /\bnegotiation|negotiating\b/],
    ['meeting', /\bmeeting\b/],
  ];

  for (const [label, pattern] of checks) {
    if (pattern.test(clean)) {
      return label;
    }
  }

  return fallback;
}

export function distillContextSubject(context: string, fallback: string) {
  const clean = normalizeWhitespace(context);
  if (!clean) {
    return fallback;
  }

  const subjectPatterns: RegExp[] = [
    /\babout\s+(.+)$/i,
    /\bon\s+(.+)$/i,
    /\bcovering\s+(.+)$/i,
    /\bfocused on\s+(.+)$/i,
    /\bworking on\s+(.+)$/i,
    /\bfor\s+(.+)$/i,
  ];

  for (const pattern of subjectPatterns) {
    const match = clean.match(pattern);
    if (match?.[1]) {
      const candidate = cleanTopicCandidate(match[1]);
      if (candidate) {
        return candidate;
      }
    }
  }

  const scenario = inferConversationScenario(clean, '');
  if (scenario === 'performance review') {
    return 'your recent impact, growth, and next priorities';
  }

  if (scenario === 'sprint review') {
    return 'the latest sprint results, release readiness, and current risks';
  }

  if (scenario === 'standup') {
    return "recent progress, blockers, and today's priorities";
  }

  if (scenario === 'one-to-one') {
    return 'recent progress, blockers, and support needs';
  }

  if (scenario === 'interview') {
    const lower = clean.toLowerCase();
    if (/\b(interviewer|interviewing|candidate|hiring manager|panel)\b/.test(lower)) {
      return "the candidate's experience, judgement, and fit for the role";
    }

    return 'your experience, decisions, and results';
  }

  return distillContextTopic(clean, fallback);
}

export function splitContextFocusAreas(subject: string) {
  return normalizeWhitespace(subject)
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((item) => cleanTopicCandidate(item))
    .filter((item, index, items) => item && items.indexOf(item) === index)
    .slice(0, 4);
}

export function detectPracticeProfileKey(context: string, availableKeys: string[]) {
  const clean = normalizeWhitespace(context).toLowerCase();
  const set = new Set(availableKeys);

  const checks: Array<[string, RegExp]> = [
    ['qa', /\b(qa|quality|test|testing|bug|regression|retest|release risk|staging)\b/],
    ['data', /\b(data|analytics|dashboard|retention|model|forecast|dataset|scientist)\b/],
    ['frontend', /\b(frontend|ui|ux|react|design|prototype|accessibility)\b/],
    ['backend', /\b(backend|api|service|platform|billing|database|migration|authentication|stability)\b/],
    ['product', /\b(product|roadmap|launch|discovery|priorit|feature rollout|rollout)\b/],
  ];

  for (const [key, pattern] of checks) {
    if (set.has(key) && pattern.test(clean)) {
      return key;
    }
  }

  if (set.has('general')) {
    return 'general';
  }

  return availableKeys[0] || 'general';
}

export function inferConversationContext(context: string, fallbackTopic: string) {
  const clean = normalizeWhitespace(context);
  const lower = clean.toLowerCase();
  const scenario = inferConversationScenario(clean, 'meeting');
  const topic = distillContextTopic(clean, fallbackTopic);
  const subject = distillContextSubject(clean, fallbackTopic);
  const focusAreas = splitContextFocusAreas(subject);

  let learnerRole = 'participant';
  let counterpartRole = 'colleague';
  let learnerLeadsConversation = false;

  if (scenario === 'performance review' || (scenario === 'one-to-one' && /\b(team lead|manager|lead)\b/.test(lower))) {
    learnerRole = /\b(manager|team lead)\b/.test(lower) && /\b(my team|my direct report|my report)\b/.test(lower) ? 'manager' : 'individual contributor';
    counterpartRole = learnerRole === 'manager' ? 'team member' : 'manager';
    learnerLeadsConversation = learnerRole === 'manager';
  } else if (scenario === 'interview') {
    if (/\b(interviewer|interviewing|candidate|hiring manager|panel)\b/.test(lower)) {
      learnerRole = 'interviewer';
      counterpartRole = 'candidate';
      learnerLeadsConversation = true;
    } else {
      learnerRole = 'candidate';
      counterpartRole = 'interviewer';
      learnerLeadsConversation = false;
    }
  } else if (scenario === 'sprint review' || scenario === 'presentation' || scenario === 'demo') {
    learnerRole = 'presenter';
    counterpartRole = 'audience';
    learnerLeadsConversation = false;
  } else if (scenario === 'standup') {
    learnerRole = 'team member';
    counterpartRole = 'facilitator';
    learnerLeadsConversation = false;
  } else if (scenario === 'negotiation') {
    learnerRole = /\b(customer|buyer|client)\b/.test(lower) ? 'buyer' : 'seller';
    counterpartRole = learnerRole === 'buyer' ? 'seller' : 'buyer';
    learnerLeadsConversation = false;
  }

  return {
    scenario,
    topic,
    subject,
    focus: focusAreas[0] || subject,
    focusAreas,
    learnerRole,
    counterpartRole,
    learnerLeadsConversation,
  };
}
