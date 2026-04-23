import type {
  AnsweringSession,
  AnsweringSessionMode,
  AppContent,
  AskAfterBrief,
  ClarifyExercise,
  CoachChatSession,
  QuestionFormationExercise,
  SpeechToTextResult,
  TextToSpeechResult,
} from '@softskills/domain';
import { apiBaseUrl } from './config';

type DebugPayload = {
  scope: string;
  event: string;
  details?: Record<string, unknown>;
};

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

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
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
    const message = error instanceof Error ? error.message : String(error);
    void sendDebugLog({ scope: 'api', event: 'request:exception', details: { path, method, message } });
    throw new Error(message);
  }
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
    return request('/api/content');
  },
  getAdminContent(): Promise<AppContent> {
    return request('/api/admin/content');
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
  getAdminBackupExportUrl() {
    return resolveApiUrl('/api/admin/backup/export');
  },
  restoreAdminBackup(fileName: string, base64: string) {
    return request<{ restored: boolean; restartRequired: boolean; restoredAt: string; fileCount: number }>('/api/admin/backup/import', {
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
    return request('/api/practice/after-talk', { method: 'POST', body: JSON.stringify({ context, offset }) });
  },
  checkAskAfter(payload: { question: string; expectedQuestion?: string; detail?: string; contextPhrase?: string; followUpPhrase?: string }) {
    return request<{ accepted: boolean; feedback: string }>('/api/practice/after-talk/check', { method: 'POST', body: JSON.stringify(payload) });
  },
  generateQuestionFormation(context = '', offset = 0): Promise<QuestionFormationExercise> {
    return request('/api/practice/question-formation', { method: 'POST', body: JSON.stringify({ context, offset }) });
  },
  checkQuestionFormation(payload: {
    userQuestion: string;
    sentence: string;
    answer: string;
    whWord: string;
    expectedQuestion: string;
    acceptedQuestions?: string[];
  }) {
    return request<{ accepted: boolean; feedback: string }>('/api/practice/question-formation/check', { method: 'POST', body: JSON.stringify(payload) });
  },
  startAnswering(context: string, mode: AnsweringSessionMode): Promise<AnsweringSession> {
    return request('/api/answering/session/start', { method: 'POST', body: JSON.stringify({ context, mode }) });
  },
  respondAnswering(sessionId: string, reactionOptionId: string, userReply: string, transcriptSource: 'text' | 'speech' = 'text'): Promise<AnsweringSession> {
    return request('/api/answering/session/respond', { method: 'POST', body: JSON.stringify({ sessionId, reactionOptionId, userReply, transcriptSource }) });
  },
  startCoachChat(context: string, goal: string, scenario: string): Promise<CoachChatSession> {
    return request('/api/coach/session/start', { method: 'POST', body: JSON.stringify({ context, goal, scenario }) });
  },
  continueCoachChat(sessionId: string, userReply: string): Promise<CoachChatSession> {
    return request('/api/coach/session/respond', { method: 'POST', body: JSON.stringify({ sessionId, userReply }) });
  },
  speechToText(audioBase64: string, mimeType: string): Promise<SpeechToTextResult> {
    return request('/api/speech/stt', { method: 'POST', body: JSON.stringify({ audioBase64, mimeType }) });
  },
  textToSpeech(text: string): Promise<TextToSpeechResult> {
    return request('/api/speech/tts', { method: 'POST', body: JSON.stringify({ text }) });
  },
};
