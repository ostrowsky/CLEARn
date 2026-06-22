import type {
  AnsweringSession,
  AnsweringSessionMode,
  AnsweringQuestionTurn,
  AnsweringReactionCategory,
  AppContent,
  AskAfterBrief,
  ClarifyExercise,
  CoachChatSession,
  QuestionFormationExercise,
  SpeechToTextResult,
  TextToSpeechResult,
} from '@clearn/domain';
import { apiBaseUrl } from './config';
import { checkQuestionFormationFallback } from './questionFormationFallback';
import { isAppContent, staticContent } from './staticContent';

type AnsweringMode = Exclude<AnsweringSessionMode, 'mixed'>;

type DebugPayload = {
  scope: string;
  event: string;
  details?: Record<string, unknown>;
};

type VideoTranscriptResponse = {
  available: boolean;
  source: 'youtube' | 'unsupported';
  text: string;
  start: number;
  end: number;
  message?: string;
};

function getRequestTimeoutMs(path: string) {
  if (path.includes('/api/speech/stt')) {
    return 15000;
  }

  if (path.includes('/api/speech/tts')) {
    return 15000;
  }

  if (path.includes('/api/admin/media/') || path.includes('/api/admin/backup/')) {
    return 120000;
  }

  if (path.includes('/api/admin/auth/') || path.includes('/api/admin/content')) {
    return 30000;
  }

  if (path.includes('/api/media/youtube-transcript-segment')) {
    return 30000;
  }

  return 5000;
}

function describeRequestException(error: unknown, path: string) {
  if (error instanceof Error && error.name === 'AbortError') {
    return `Request timed out while calling ${path}. Check that the CLEARn API is running at ${apiBaseUrl}.`;
  }

  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
    return `Cannot reach the CLEARn API at ${apiBaseUrl}. Start the API server or check the production API URL.`;
  }

  return error instanceof Error ? error.message : String(error);
}

async function sendDebugLog(payload: DebugPayload) {
  try {
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[CLEARn debug]', payload.scope, payload.event, payload.details || {});
    }

    await fetch(`${apiBaseUrl}/api/debug/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method || 'GET';
  void sendDebugLog({ scope: 'api', event: 'request:start', details: { path, method } });
  const headers = {
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers ?? {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getRequestTimeoutMs(path));
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers,
      credentials: 'include',
      signal: controller.signal,
      ...init,
    });

    let json: Record<string, unknown> = {};
    try {
      json = await response.json();
    } catch {
      json = {};
    }

    if (!response.ok) {
      const message = (json.message as string) || (json.error as string) || response.statusText || String(response.status);
      void sendDebugLog({ scope: 'api', event: 'request:error', details: { path, method, status: response.status, message } });
      throw new Error(message);
    }

    void sendDebugLog({ scope: 'api', event: 'request:success', details: { path, method, status: response.status } });
    return json as T;
  } catch (error) {
    const message = describeRequestException(error, path);
    void sendDebugLog({ scope: 'api', event: 'request:exception', details: { path, method, message } });
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAppContent(): Promise<AppContent> {
  try {
    const content = await request<unknown>('/api/content');
    if (isAppContent(content)) {
      return content;
    }

    throw new Error('The content endpoint did not return app content.');
  } catch (error) {
    void sendDebugLog({
      scope: 'content',
      event: 'load:static-fallback',
      details: {
        message: error instanceof Error ? error.message : String(error),
        sectionCount: staticContent.sections.length,
      },
    });
    return staticContent;
  }
}

async function requestWithFallback<T>(path: string, init: RequestInit | undefined, fallback: (error: Error) => T): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    const nextError = error instanceof Error ? error : new Error(String(error));
    void sendDebugLog({
      scope: 'api',
      event: 'request:fallback',
      details: { path, message: nextError.message },
    });
    return fallback(nextError);
  }
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function inferTopic(context: string) {
  const clean = normalizeText(context)
    .replace(/^i\s+am\s+(preparing|getting ready)\s+(for\s+)?/i, '')
    .replace(/^the\s+speech\s+is\s+about\s+/i, '')
    .replace(/^about\s+/i, '');

  return clean || 'the meeting topic';
}

function buildAskAfterFallback(context: string, offset = 0, error?: Error): AskAfterBrief {
  const topic = inferTopic(context);
  const facts = [
    `Today I want to talk about ${topic}.`,
    'The main goal is to make the next decision easier for the team.',
    'One risk is that we still need clearer ownership and timing.',
    'The next step is to agree what should happen before the next update.',
  ];
  const focus = ['the next decision', 'ownership', 'timing', 'the main risk'][Math.abs(offset) % 4] || 'the next decision';

  return {
    speechLines: facts,
    sampleQuestion: `You mentioned ${focus}. Could you explain that in a bit more detail?`,
    suggestedFocus: focus,
    coachingTip: 'Use one short reference to the talk first, then ask for the missing detail with a clear follow-up question.',
    generatorMode: 'client-fallback',
    providerError: error?.message,
  };
}

const questionFormationDeck: QuestionFormationExercise[] = [
  {
    sentence: 'Stakeholders will review return on investment at the end of the year.',
    blanks: [
      {
        id: 'stakeholders',
        index: 1,
        answer: 'Stakeholders',
        whWord: 'Who',
        expectedQuestion: 'Who will review return on investment?',
        acceptedQuestions: ['Who will review it?', 'Who will review return on investment?'],
      },
      {
        id: 'roi',
        index: 2,
        answer: 'return on investment',
        whWord: 'What',
        expectedQuestion: 'What will stakeholders review?',
        acceptedQuestions: ['What will stakeholders review?', 'What will they review?'],
      },
      {
        id: 'year-end',
        index: 3,
        answer: 'the end of the year',
        whWord: 'When',
        expectedQuestion: 'When will stakeholders review return on investment?',
        acceptedQuestions: ['When will stakeholders review it?', 'When will they review it?'],
      },
    ],
    coachingTip: 'Keep the auxiliary verb before the subject and ask one clear WH question.',
    generatorMode: 'client-fallback',
  },
  {
    sentence: 'The data platform squad will test the onboarding flow in staging this afternoon.',
    blanks: [
      {
        id: 'squad',
        index: 1,
        answer: 'The data platform squad',
        whWord: 'Who',
        expectedQuestion: 'Who will test the onboarding flow?',
        acceptedQuestions: ['Who will test it?', 'Who will test the onboarding flow?'],
      },
      {
        id: 'flow',
        index: 2,
        answer: 'the onboarding flow',
        whWord: 'What',
        expectedQuestion: 'What will the data platform squad test?',
        acceptedQuestions: ['What will the data platform squad test?', 'What will they test?'],
      },
      {
        id: 'staging',
        index: 3,
        answer: 'staging',
        whWord: 'Where',
        expectedQuestion: 'Where will the data platform squad test the onboarding flow?',
        acceptedQuestions: ['Where will they test it?', 'Where will the data platform squad test it?'],
      },
    ],
    coachingTip: 'Use who for people or teams, what for objects, and where for places or environments.',
    generatorMode: 'client-fallback',
  },
  {
    sentence: 'The mobile release manager delayed the rollout because two payment tests failed.',
    blanks: [
      {
        id: 'manager',
        index: 1,
        answer: 'The mobile release manager',
        whWord: 'Who',
        expectedQuestion: 'Who delayed the rollout?',
        acceptedQuestions: ['Who delayed it?', 'Who delayed the rollout?'],
      },
      {
        id: 'reason',
        index: 2,
        answer: 'because two payment tests failed',
        whWord: 'Why',
        expectedQuestion: 'Why did the mobile release manager delay the rollout?',
        acceptedQuestions: ['Why did the mobile release manager delay it?', 'Why was it delayed?'],
      },
      {
        id: 'tests',
        index: 3,
        answer: 'two payment tests',
        whWord: 'How many',
        expectedQuestion: 'How many payment tests failed?',
        acceptedQuestions: ['How many payment tests failed?', 'How many tests failed?'],
      },
    ],
    coachingTip: 'Why asks for the reason; how many asks for a count.',
    generatorMode: 'client-fallback',
  },
];

function buildQuestionFormationFallback(offset = 0, error?: Error): QuestionFormationExercise {
  const base = questionFormationDeck[Math.abs(offset) % questionFormationDeck.length] || questionFormationDeck[0];
  return {
    ...base,
    blanks: base.blanks.map((blank) => ({ ...blank })),
    providerError: error?.message,
  };
}

const answeringModes: AnsweringMode[] = ['good', 'difficult', 'unnecessary', 'irrelevant'];

function getAnsweringCategories(): AnsweringReactionCategory[] {
  return [
    {
      type: 'good' as const,
      label: "It's a good question",
      options: [{ id: 'good-useful', text: 'Thanks, that is a useful question.', categoryType: 'good' as const }],
    },
    {
      type: 'difficult' as const,
      label: "It's a difficult question",
      options: [{ id: 'difficult-directly', text: 'Sure, let me answer that directly.', categoryType: 'difficult' as const }],
    },
    {
      type: 'unnecessary' as const,
      label: "It's an unnecessary question",
      options: [{ id: 'unnecessary-now', text: 'That is not really important right now.', categoryType: 'unnecessary' as const }],
    },
    {
      type: 'irrelevant' as const,
      label: "It's an irrelevant question",
      options: [{ id: 'irrelevant-move-on', text: 'We already covered that, so let us move on.', categoryType: 'irrelevant' as const }],
    },
  ];
}

function buildAnsweringTurn(context: string, mode: AnsweringSessionMode, index: number): AnsweringQuestionTurn {
  const questionType = mode === 'mixed' ? answeringModes[(index - 1) % answeringModes.length] || 'good' : mode;
  const topic = inferTopic(context);
  const questionByType: Record<AnsweringMode, string> = {
    good: `Which result around ${topic} should we highlight first, and why does it matter?`,
    difficult: `What is the biggest risk in ${topic}, and how would you reduce it?`,
    unnecessary: `Can you explain every minor detail behind ${topic} right now?`,
    irrelevant: `Could you tell me about a different project instead of ${topic}?`,
  };
  const categories = getAnsweringCategories();
  const matching = categories.find((item) => item.type === questionType) || categories[0];

  return {
    turnId: createId('turn'),
    index,
    questionType,
    questionTypeLabel: matching.label,
    questionText: questionByType[questionType],
    reactionOptions: categories.flatMap((item) => item.options),
    reactionCategories: categories,
    preferredReactionIds: matching.options.map((item) => item.id),
    preferredReactionText: matching.options[0]?.text || '',
  };
}

const fallbackAnsweringSessions = new Map<string, AnsweringSession>();

function buildAnsweringSession(context: string, mode: AnsweringSessionMode, error?: Error): AnsweringSession {
  const session: AnsweringSession = {
    sessionId: createId('answering'),
    mode,
    context,
    totalQuestions: 10,
    completed: false,
    currentTurn: buildAnsweringTurn(context, mode, 1),
    turns: [],
  };
  if (error?.message && session.currentTurn) {
    session.currentTurn.providerError = error.message;
  }
  fallbackAnsweringSessions.set(session.sessionId, session);
  return session;
}

function respondAnsweringFallback(sessionId: string, reactionOptionId: string, userReply: string): AnsweringSession {
  const session = fallbackAnsweringSessions.get(sessionId) || buildAnsweringSession('', 'mixed');
  const turn = session.currentTurn;
  if (!turn) {
    return session;
  }

  const chosen = turn.reactionOptions.find((item) => item.id === reactionOptionId);
  const reactionText = chosen?.text || turn.preferredReactionText;
  const answerText = normalizeText(userReply);
  const completedTurn = {
    ...turn,
    chosenReactionId: reactionOptionId,
    chosenReactionText: reactionText,
    answerText,
    transcriptSource: 'text' as const,
    evaluation: {
      reactionAccepted: turn.preferredReactionIds.includes(reactionOptionId),
      politenessScore: reactionText ? 4 : 2,
      grammarScore: answerText.split(' ').length > 5 ? 4 : 3,
      briefFeedback: 'Good start. Keep the answer specific, calm, and professional.',
      improvedAnswer: `${reactionText} ${answerText || 'I would focus on the most important next step and explain the reason clearly.'}`.trim(),
      grammarFixes: answerText ? ['Keep the sentence direct and complete.'] : ['Add a concrete answer after the reaction phrase.'],
      toneFixes: ['Keep the selected reaction phrase unchanged, then improve only the answer.'],
    },
  };
  const turns = [...session.turns, completedTurn];
  const nextIndex = turns.length + 1;
  const nextSession: AnsweringSession = {
    ...session,
    turns,
    completed: nextIndex > session.totalQuestions,
    currentTurn: nextIndex > session.totalQuestions ? null : buildAnsweringTurn(session.context, session.mode, nextIndex),
  };
  fallbackAnsweringSessions.set(sessionId, nextSession);
  return nextSession;
}

const fallbackCoachSessions = new Map<string, CoachChatSession>();

function buildCoachSession(context: string, goal: string, scenario: string, error?: Error): CoachChatSession {
  const topic = inferTopic(context);
  const session: CoachChatSession = {
    sessionId: createId('coach'),
    context,
    goal,
    scenario,
    completed: false,
    messages: [{
      id: createId('msg'),
      role: 'assistant',
      text: `What is the most important point you want to communicate about ${topic}?`,
      createdAt: new Date().toISOString(),
    }],
    feedback: 'Answer in one natural sentence, then add one practical detail.',
    suggestions: ['The key point is...', 'The risk I want to explain is...', 'The decision we need is...'],
    capabilities: { text: true, speechToText: true, textToSpeech: false },
    messageLimit: 4,
    transcriptMode: 'text',
    providerError: error?.message,
  };
  fallbackCoachSessions.set(session.sessionId, session);
  return session;
}

function continueCoachFallback(sessionId: string, userReply: string): CoachChatSession {
  const session = fallbackCoachSessions.get(sessionId) || buildCoachSession('', '', 'meeting');
  const nextMessages = [
    ...session.messages,
    { id: createId('msg'), role: 'user' as const, text: userReply, createdAt: new Date().toISOString() },
  ];
  const assistantPrompts = [
    'What detail would make that clearer for the listener?',
    'What decision or support do you need next?',
    'How would you say that more confidently in the meeting?',
  ];
  const assistantTurnCount = nextMessages.filter((item) => item.role === 'assistant').length;
  const completed = assistantTurnCount >= session.messageLimit;
  if (!completed) {
    nextMessages.push({
      id: createId('msg'),
      role: 'assistant',
      text: assistantPrompts[(assistantTurnCount - 1) % assistantPrompts.length] || assistantPrompts[0],
      createdAt: new Date().toISOString(),
    });
  }
  const nextSession = {
    ...session,
    completed,
    messages: nextMessages,
    feedback: 'Good. Keep it specific and avoid repeating the same wording.',
  };
  fallbackCoachSessions.set(sessionId, nextSession);
  return nextSession;
}

export function resolveApiUrl(path = '') {
  if (!path) {
    return apiBaseUrl;
  }

  if (/^https?:\/\//.test(path)) {
    return path;
  }

  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export const apiClient = {
  logDebug(scope: string, event: string, details?: Record<string, unknown>) {
    return sendDebugLog({ scope, event, details });
  },
  getDebugLogs() {
    return request<{ entries: Array<Record<string, unknown>> }>('/api/debug/logs');
  },
  getContent(): Promise<AppContent> {
    return requestAppContent();
  },
  getAdminContent(): Promise<AppContent> {
    return request('/api/admin/content');
  },
  getAdminAuthStatus() {
    return request<{ configured: boolean; authenticated: boolean; login: string }>('/api/admin/auth/status');
  },
  setupAdminAuth(payload: { login: string; password: string; confirmPassword: string; recoveryEmail: string }) {
    return request<{ configured: boolean; authenticated: boolean; login: string }>('/api/admin/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  loginAdmin(payload: { login: string; password: string }) {
    return request<{ configured: boolean; authenticated: boolean; login: string }>('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  resetAdminPassword(payload: { login: string; recoveryEmail: string; password: string; confirmPassword: string }) {
    return request<{ configured: boolean; authenticated: boolean; login: string }>('/api/admin/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  logoutAdmin() {
    return request<{ loggedOut: boolean }>('/api/admin/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  },
  saveAdminContent(content: AppContent): Promise<AppContent> {
    return request('/api/admin/content', { method: 'POST', body: JSON.stringify(content) });
  },
  uploadAdminMedia(fileName: string, base64: string) {
    return request<{ url: string; fileName: string; size: number }>('/api/admin/media/upload', {
      method: 'POST',
      body: JSON.stringify({ fileName, base64 }),
    });
  },
  deleteAdminMedia(url: string) {
    return request<{ deleted: boolean; url: string }>('/api/admin/media/delete', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },
  getVideoTranscript(url: string): Promise<VideoTranscriptResponse> {
    return requestWithFallback(
      `/api/media/youtube-transcript-segment?url=${encodeURIComponent(url)}`,
      undefined,
      () => ({
        available: false,
        source: 'youtube',
        text: '',
        start: 0,
        end: 0,
        message: 'Transcript is temporarily unavailable. Try fetching it again or add it manually in admin.',
      }),
    );
  },
  getAdminBackupExportUrl() {
    return resolveApiUrl('/api/admin/backup/export');
  },
  restoreAdminBackup(fileName: string, base64: string) {
    return request<{ restored: boolean; restartRequired: boolean; restoredAt: string; fileCount: number }>('/api/admin/backup/import', {
      method: 'POST',
      body: JSON.stringify({ fileName, base64 }),
    });
  },
  getAdminMediaBackupExportUrl() {
    return resolveApiUrl('/api/admin/backup/media/export');
  },
  restoreAdminMediaBackup(fileName: string, base64: string) {
    return request<{ restored: boolean; restartRequired: boolean; restoredAt: string; fileCount: number }>('/api/admin/backup/media/import', {
      method: 'POST',
      body: JSON.stringify({ fileName, base64 }),
    });
  },
  generateClarify(context: string, offset = 0): Promise<ClarifyExercise> {
    return request('/api/practice/clarify', { method: 'POST', body: JSON.stringify({ context, offset }) });
  },
  checkClarify(payload: { userQuestion: string; expectedQuestion: string; target?: string; focus?: string; acceptedAnswers?: string[] }) {
    return request<{ accepted: boolean; feedback: string }>('/api/practice/clarify/check', { method: 'POST', body: JSON.stringify(payload) });
  },
  askAfter(context: string, offset = 0): Promise<AskAfterBrief> {
    return requestWithFallback(
      '/api/practice/after-talk',
      { method: 'POST', body: JSON.stringify({ context, offset }) },
      (error) => buildAskAfterFallback(context, offset, error),
    );
  },
  checkAskAfter(payload: { question: string; expectedQuestion?: string; detail?: string; contextPhrase?: string; followUpPhrase?: string }) {
    return requestWithFallback(
      '/api/practice/after-talk/check',
      { method: 'POST', body: JSON.stringify(payload) },
      () => {
        const question = normalizeText(payload.question).toLowerCase();
        const detail = normalizeText(payload.detail || '').toLowerCase();
        const accepted = Boolean(question && question.includes('could') && question.endsWith('?') && (!detail || question.includes(detail)));
        return {
          accepted,
          feedback: accepted
            ? 'Strong follow-up. You anchored the question in the talk and then asked for a clear extra detail.'
            : 'Try to include the detail from the talk and finish with one clear follow-up question.',
        };
      },
    );
  },
  generateQuestionFormation(context = '', offset = 0): Promise<QuestionFormationExercise> {
    return requestWithFallback(
      '/api/practice/question-formation',
      { method: 'POST', body: JSON.stringify({ context, offset }) },
      (error) => buildQuestionFormationFallback(offset, error),
    );
  },
  checkQuestionFormation(payload: {
    userQuestion: string;
    sentence: string;
    answer: string;
    whWord: string;
    expectedQuestion: string;
    acceptedQuestions?: string[];
  }) {
    return requestWithFallback(
      '/api/practice/question-formation/check',
      { method: 'POST', body: JSON.stringify(payload) },
      () => checkQuestionFormationFallback(payload),
    );
  },
  startAnswering(context: string, mode: AnsweringSessionMode): Promise<AnsweringSession> {
    return requestWithFallback(
      '/api/answering/session/start',
      { method: 'POST', body: JSON.stringify({ context, mode }) },
      (error) => buildAnsweringSession(context, mode, error),
    );
  },
  respondAnswering(sessionId: string, reactionOptionId: string, userReply: string, transcriptSource: 'text' | 'speech' = 'text'): Promise<AnsweringSession> {
    return requestWithFallback(
      '/api/answering/session/respond',
      { method: 'POST', body: JSON.stringify({ sessionId, reactionOptionId, userReply, transcriptSource }) },
      () => respondAnsweringFallback(sessionId, reactionOptionId, userReply),
    );
  },
  startCoachChat(context: string, goal: string, scenario: string): Promise<CoachChatSession> {
    return requestWithFallback(
      '/api/coach/session/start',
      { method: 'POST', body: JSON.stringify({ context, goal, scenario }) },
      (error) => buildCoachSession(context, goal, scenario, error),
    );
  },
  continueCoachChat(sessionId: string, userReply: string): Promise<CoachChatSession> {
    return requestWithFallback(
      '/api/coach/session/respond',
      { method: 'POST', body: JSON.stringify({ sessionId, userReply }) },
      () => continueCoachFallback(sessionId, userReply),
    );
  },
  speechToText(audioBase64: string, mimeType: string): Promise<SpeechToTextResult> {
    return request('/api/speech/stt', { method: 'POST', body: JSON.stringify({ audioBase64, mimeType }) });
  },
  textToSpeech(text: string): Promise<TextToSpeechResult> {
    return request('/api/speech/tts', { method: 'POST', body: JSON.stringify({ text }) });
  },
};
