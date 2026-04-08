import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnsweringSession, CoachChatSession } from '@softskills/domain';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { BackupService } from '../modules/backup/backup.service';
import { FileSystemContentRepository } from '../modules/content/content.repository';
import { ContentService } from '../modules/content/content.service';
import { LocalMediaStore, resolveLocalUploadPath } from '../modules/content/media.store';
import { PracticeService } from '../modules/practice/practice.service';
import { AnsweringSessionService } from '../modules/session/answering.service';
import { CoachChatSessionService } from '../modules/session/coach.service';
import { InMemorySessionStore, RedisSessionStore } from '../modules/session/session.store';
import { SpeechService } from '../modules/speech/speech.service';

type DebugLogEntry = {
  id: string;
  timestamp: string;
  scope: string;
  event: string;
  details: Record<string, unknown>;
};

function getContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.opus':
      return 'audio/opus';
    default:
      return 'application/octet-stream';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isBadRequestMessage(message: string) {
  return /choose the most appropriate reaction phrase|type or dictate your answer|user reply is required|required\./i.test(String(message || ''));
}

export async function registerRoutes(app: FastifyInstance) {
  const contentService = new ContentService(new FileSystemContentRepository(), new LocalMediaStore());
  const practiceService = new PracticeService(contentService);
  const speechService = new SpeechService();
  const backupService = new BackupService();
  const answeringStore = env.APP_ENV === 'production'
    ? new RedisSessionStore<AnsweringSession>()
    : new InMemorySessionStore<AnsweringSession>();
  const coachStore = env.APP_ENV === 'production'
    ? new RedisSessionStore<CoachChatSession>()
    : new InMemorySessionStore<CoachChatSession>();
  const answeringService = new AnsweringSessionService(answeringStore, contentService);
  const coachChatService = new CoachChatSessionService(coachStore, contentService);
  const debugLogs: DebugLogEntry[] = [];

  function pushDebugLog(scope: string, event: string, details: Record<string, unknown> = {}) {
    const entry: DebugLogEntry = {
      id: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      scope,
      event,
      details,
    };

    debugLogs.push(entry);
    if (debugLogs.length > 300) {
      debugLogs.splice(0, debugLogs.length - 300);
    }

    app.log.info({ debug: entry }, `debug:${scope}:${event}`);
    return entry;
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    textProvider: env.LLM_TEXT_PROVIDER,
    sttProvider: env.LLM_STT_PROVIDER,
    ttsProvider: env.LLM_TTS_PROVIDER,
    appEnv: env.APP_ENV,
  }));

  app.get('/api/debug/logs', async () => ({ entries: debugLogs }));
  app.post('/api/debug/log', async (request) => {
    const body = request.body as { scope?: string; event?: string; details?: Record<string, unknown> };
    return {
      logged: true,
      entry: pushDebugLog(String(body.scope || 'client'), String(body.event || 'event'), asRecord(body.details)),
    };
  });

  app.get('/api/content', async () => contentService.getContent());
  app.get('/api/admin/content', async () => contentService.getContent());
  app.post('/api/admin/content', async (request) => {
    const body = request.body as { content?: unknown };
    return contentService.saveContent((body.content ?? request.body) as never);
  });
  app.post('/api/admin/media/upload', async (request) => {
    const body = request.body as { fileName: string; base64: string };
    return contentService.uploadMedia(body.fileName, body.base64);
  });
  app.post('/api/admin/media/delete', async (request) => {
    const body = request.body as { url: string };
    return contentService.deleteMedia(body.url);
  });

  app.get('/api/admin/backup/export', async (_request, reply) => {
    const backup = await backupService.createBackup();
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename=' + JSON.stringify(backup.fileName))
      .send(backup.bytes);
  });
  app.post('/api/admin/backup/import', async (request) => {
    const body = request.body as { fileName?: string; base64?: string };
    return backupService.restoreBackup(String(body.fileName || 'softskills-backup.zip'), String(body.base64 || ''));
  });

  app.get('/uploads/*', async (request, reply) => {
    const wildcard = (request.params as { '*': string })['*'] || '';
    const absolutePath = resolveLocalUploadPath(`/uploads/${wildcard}`);
    if (!absolutePath) {
      return reply.code(404).send({ error: 'File not found.' });
    }

    try {
      const bytes = await readFile(absolutePath);
      return reply.type(getContentType(absolutePath)).send(bytes);
    } catch {
      return reply.code(404).send({ error: 'File not found.' });
    }
  });

  app.post('/api/practice/clarify', async (request) => {
    const body = request.body as { context: string; offset?: number };
    return practiceService.generateClarify(body.context, body.offset);
  });
  app.post('/api/practice/clarify/check', async (request) => practiceService.checkClarify(request.body as never));
  app.post('/api/practice/after-talk', async (request) => {
    const body = request.body as { context: string; offset?: number };
    return practiceService.generateAskAfter(body.context, body.offset);
  });
  app.post('/api/practice/after-talk/check', async (request) => {
    const body = request.body as { question: string };
    return practiceService.checkAskAfter(body.question);
  });

  app.post('/api/answering/session/start', async (request) => {
    const body = request.body as { context: string; mode: 'good' | 'difficult' | 'unnecessary' | 'irrelevant' | 'mixed' };
    return answeringService.start(body.context, body.mode);
  });
  app.post('/api/answering/session/respond', async (request, reply) => {
    const body = request.body as { sessionId: string; reactionOptionId?: string; userReply: string; transcriptSource?: 'text' | 'speech' };
    if (!String(body.reactionOptionId || '').trim()) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Choose the most appropriate reaction phrase before you submit the answer.',
      });
    }

    try {
      return await answeringService.respond(body.sessionId, body.reactionOptionId, body.userReply, body.transcriptSource || 'text');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isBadRequestMessage(message)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message,
        });
      }

      throw error;
    }
  });

  app.post('/api/coach/session/start', async (request) => {
    const body = request.body as { context: string; goal: string; scenario?: string };
    return coachChatService.start(body.context, body.goal, body.scenario || '');
  });
  app.post('/api/coach/session/respond', async (request) => {
    const body = request.body as { sessionId: string; userReply: string };
    return coachChatService.respond(body.sessionId, body.userReply);
  });

  app.post('/api/speech/stt', async (request) => {
    const body = request.body as { audioBase64?: string; mimeType?: string };
    pushDebugLog('speech', 'stt:start', {
      mimeType: String(body?.mimeType || ''),
      hasAudio: Boolean(body?.audioBase64),
      audioSize: String(body?.audioBase64 || '').length,
      provider: env.LLM_STT_PROVIDER,
      model: env.LLM_STT_MODEL,
    });

    try {
      const result = await speechService.speechToText(request.body as never);
      pushDebugLog('speech', 'stt:success', {
        provider: result.provider,
        model: result.model,
        textLength: String(result.text || '').length,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDebugLog('speech', 'stt:error', { message });
      throw error;
    }
  });

  app.post('/api/speech/tts', async (request) => {
    pushDebugLog('speech', 'tts:start', { provider: env.LLM_TTS_PROVIDER, model: env.LLM_TTS_MODEL });
    try {
      const result = await speechService.textToSpeech(request.body as never);
      pushDebugLog('speech', 'tts:success', { provider: result.provider, model: result.model });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDebugLog('speech', 'tts:error', { message });
      throw error;
    }
  });
}