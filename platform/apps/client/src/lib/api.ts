import { checkClarifyAnswer, checkAskAfterAnswer, checkQuestionFormationAnswer } from '@clearn/domain';
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
import { trackExerciseEvent } from './analytics';
import { isAppContent, staticContent } from './staticContent';
import { validApiResponse } from './apiResponse';

let lastLoadedContent = staticContent;

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
    return 20000;
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

  if (/^\/api\/(practice|answering|coach)\//.test(path)) return 15000;
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

export class ApiRequestError extends Error {
 constructor(message: string, public kind: 'http'|'contract'|'network'|'timeout', public status?: number) { super(message); this.name='ApiRequestError'; }
}
let apiUnavailableUntil=0;
export function isApiUnavailable() { return Date.now()<apiUnavailableUntil; }
export function practiceNotice(key: 'speechApiUnavailable'|'speechBrowserRecognition'|'answeringFallbackNotice') {
 const current=(lastLoadedContent.meta?.ui as any)?.feedback?.[key];
 const bundled=(staticContent.meta?.ui as any)?.feedback?.[key];
 return String(current||bundled||'Speech is unavailable. Type your answer instead.');
}
async function sendDebugLog(payload: DebugPayload) {
 if(process.env.NODE_ENV==='production'||process.env.EXPO_PUBLIC_ENABLE_API_DEBUG!=='1') return;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2000);
 try {
  console.debug('[CLEARn debug]',payload.scope,payload.event,payload.details||{});
  const response=await fetch(apiBaseUrl+'/api/debug/log',{method:'POST',credentials:'include',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  await response.body?.cancel();
 } catch { /* Best effort and never a dependency of user actions. */ } finally { clearTimeout(timeout); }
}
async function withResponse<T>(path: string,init: RequestInit|undefined,read: (r: Response)=>Promise<T>): Promise<T> {
 const controller=new AbortController(),abort=()=>controller.abort();
 if(init?.signal?.aborted) controller.abort();
 init?.signal?.addEventListener('abort',abort,{once:true});
 const timeout=setTimeout(abort,getRequestTimeoutMs(path));
 const headers=new Headers(init?.headers);
 if(init?.body&&!headers.has('Content-Type')) headers.set('Content-Type','application/json');
 try {
  const response=await fetch(apiBaseUrl+path,{...init,headers,credentials:'include',signal:controller.signal});
  if(!response.ok){
   let json: Record<string,unknown>={};
   if(/json/i.test(response.headers.get('content-type')||'')){try{json=await response.json().then(value=>value&&typeof value==='object'?value:{});}catch(e){if(controller.signal.aborted)throw e;}}
   else await response.body?.cancel();
   const message=(json.message as string)||(json.error as string)||response.statusText||String(response.status);
   throw new ApiRequestError(message,'http',response.status);
  }
  const value=await read(response); apiUnavailableUntil=0; return value;
 } catch(error){
  const next=error instanceof ApiRequestError?error:new ApiRequestError(describeRequestException(error,path),controller.signal.aborted?'timeout':'network');
  if(next.kind==='network'||next.kind==='timeout'||next.kind==='contract'||(next.status||0)>=500)apiUnavailableUntil=Date.now()+60000;
  throw next;
 } finally { clearTimeout(timeout); init?.signal?.removeEventListener('abort',abort); }
}
async function request<T>(path: string,init?: RequestInit): Promise<T> {
 return withResponse(path,init,async response=>{
  if(!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(response.headers.get('content-type')||'')){
   await response.body?.cancel();throw new ApiRequestError('The API returned non-JSON for '+path.split('?')[0],'contract');
  }
  let json: unknown;
  try{json=await response.json();}catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;throw new ApiRequestError('The API returned invalid JSON for '+path.split('?')[0],'contract');}
  if(!validApiResponse(path,json))throw new ApiRequestError('The API response does not match '+path.split('?')[0],'contract');
  return json as T;
 });
}
export async function downloadAdminBackup(media=false){
 return withResponse(media?'/api/admin/backup/media/export':'/api/admin/backup/export',undefined,async response=>{
  if(!/^(application\/zip|application\/octet-stream)(?:;|$)/i.test(response.headers.get('content-type')||''))throw new ApiRequestError('The backup endpoint did not return a ZIP archive.','contract');
  const blob=await response.blob(),magic=new Uint8Array(await blob.slice(0,4).arrayBuffer());
  if(magic[0]!==0x50||magic[1]!==0x4b||!((magic[2]===3&&magic[3]===4)||(magic[2]===5&&magic[3]===6)))throw new ApiRequestError('Invalid ZIP archive.','contract');
  const name=/filename="?([^";]+)"?/i.exec(response.headers.get('content-disposition')||'')?.[1]||'clearn-backup.zip';
  return {blob,fileName:name.replace(/[\\/\r\n]/g,'_')};
 });
}

async function requestAppContent(): Promise<AppContent> {
  try {
    const content = await request<unknown>('/api/content');
    if (isAppContent(content)) {
      lastLoadedContent = content;
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
    return lastLoadedContent;
  }
}

async function requestWithFallback<T>(path: string, init: RequestInit | undefined, fallback: (error: Error) => T): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if(error instanceof ApiRequestError&&error.kind==='http'&&[400,401,403,404,422].includes(error.status||0))throw error;
    const nextError = error instanceof Error ? error : new Error(String(error));
    void sendDebugLog({
      scope: 'api',
      event: 'request:fallback',
      details: { path, message: nextError.message },
    });
    return fallback(nextError);
  }
}

function getPracticeFeedback(key: string): Record<string, unknown> {
  const bundledPractice = staticContent.meta?.practice as Record<string, unknown> | undefined;
  const loadedPractice = lastLoadedContent.meta?.practice as Record<string, unknown> | undefined;
  const bundled = bundledPractice?.[key];
  const loaded = loadedPractice?.[key];
  return {
    ...(bundled && typeof bundled === 'object' ? bundled as Record<string, unknown> : {}),
    ...(loaded && typeof loaded === 'object' ? loaded as Record<string, unknown> : {}),
  };
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
export function isLocalAnsweringSession(id:string){return fallbackAnsweringSessions.has(id);}

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
  const session = fallbackAnsweringSessions.get(sessionId);
  if(!session)throw new Error('The server session is unavailable. Please reconnect and retry.');
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
  const session = fallbackCoachSessions.get(sessionId);
  if(!session)throw new Error('The server session is unavailable. Please reconnect and retry.');
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
  async checkClarify(payload: { userQuestion: string; expectedQuestion: string; target?: string; focus?: string; acceptedAnswers?: string[] }) {
    const result = checkClarifyAnswer(payload, getPracticeFeedback('clarifyFeedback'));
    trackExerciseEvent('answer_check', 'clarification', result.accepted);
    return result;
  },
  askAfter(context: string, offset = 0): Promise<AskAfterBrief> {
    return requestWithFallback(
      '/api/practice/after-talk',
      { method: 'POST', body: JSON.stringify({ context, offset }) },
      (error) => buildAskAfterFallback(context, offset, error),
    );
  },
  async checkAskAfter(payload: { question: string; expectedQuestion?: string; detail?: string; contextPhrase?: string; followUpPhrase?: string }) {
    const result = checkAskAfterAnswer(payload, getPracticeFeedback('askAfterFeedback'));
    trackExerciseEvent('answer_check', 'ask_after_talk', result.accepted);
    return result;
  },
  generateQuestionFormation(context = '', offset = 0): Promise<QuestionFormationExercise> {
    return requestWithFallback(
      '/api/practice/question-formation',
      { method: 'POST', body: JSON.stringify({ context, offset }) },
      (error) => buildQuestionFormationFallback(offset, error),
    );
  },
  async checkQuestionFormation(payload: {
    userQuestion: string;
    sentence: string;
    answer: string;
    whWord: string;
    expectedQuestion: string;
    acceptedQuestions?: string[];
  }) {
    const result = checkQuestionFormationAnswer(payload, getPracticeFeedback('questionFormationFeedback'));
    trackExerciseEvent('answer_check', 'question_formation', result.accepted);
    return result;
  },
  startAnswering(context: string, mode: AnsweringSessionMode): Promise<AnsweringSession> {
    return requestWithFallback(
      '/api/answering/session/start',
      { method: 'POST', body: JSON.stringify({ context, mode }) },
      (error) => buildAnsweringSession(context, mode, error),
    );
  },
  respondAnswering(sessionId: string, reactionOptionId: string, userReply: string, transcriptSource: 'text' | 'speech' = 'text'): Promise<AnsweringSession> {
    if(fallbackAnsweringSessions.has(sessionId))return Promise.resolve(respondAnsweringFallback(sessionId,reactionOptionId,userReply));
    return request<AnsweringSession>(
      '/api/answering/session/respond',
      { method: 'POST', body: JSON.stringify({ sessionId, reactionOptionId, userReply, transcriptSource }) },
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
    if(fallbackCoachSessions.has(sessionId))return Promise.resolve(continueCoachFallback(sessionId,userReply));
    return request<CoachChatSession>(
      '/api/coach/session/respond',
      { method: 'POST', body: JSON.stringify({ sessionId, userReply }) },
    );
  },
  speechToText(audioBase64: string, mimeType: string): Promise<SpeechToTextResult> {
    return request<SpeechToTextResult>('/api/speech/stt', { method: 'POST', body: JSON.stringify({ audioBase64, mimeType }) }).catch(error=>{
      if(isApiUnavailable()||(error instanceof ApiRequestError&&[408,429].includes(error.status||0))){apiUnavailableUntil=Date.now()+60000;throw new ApiRequestError(practiceNotice('speechApiUnavailable'),error.kind||'network',error.status);}
      throw error;
    });
  },
  textToSpeech(text: string): Promise<TextToSpeechResult> {
    return request('/api/speech/tts', { method: 'POST', body: JSON.stringify({ text }) });
  },
};
