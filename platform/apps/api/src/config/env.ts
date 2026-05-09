import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDevContentPath = path.resolve(configDir, '..', '..', '..', '..', '..', 'web', 'data', 'content.json');
const defaultAdminAuthPath = path.resolve(configDir, '..', '..', '..', '..', '..', 'web', 'data', 'admin-auth.json');
const defaultMediaUploadsPath = path.resolve(configDir, '..', '..', '..', '..', '..', 'web', 'static', 'uploads');

function resolveStoragePath(storageRoot: string | undefined, relativePath: string, fallback: string) {
  if (storageRoot && storageRoot.trim()) {
    return path.resolve(storageRoot, relativePath);
  }

  return fallback;
}

const schema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_PORT: z.coerce.number().default(4000),
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),
  POSTGRES_URL: z.string().default('postgres://softskills:softskills@localhost:5432/softskills'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('softskills-media'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  HF_TOKEN: z.string().optional(),
  HF_CHAT_MODEL: z.string().default('Qwen/Qwen3-8B'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_TEXT_PROVIDER: z.enum(['huggingface', 'openai', 'selfhosted']).default('selfhosted'),
  LLM_STT_PROVIDER: z.enum(['huggingface', 'openai', 'selfhosted']).default('selfhosted'),
  LLM_TTS_PROVIDER: z.enum(['huggingface', 'openai', 'selfhosted']).default('huggingface'),
  LLM_CHAT_MODEL: z.string().default('gemma3:12b'),
  LLM_STT_MODEL: z.string().default('base.en'),
  LLM_TTS_MODEL: z.string().default('hexgrad/Kokoro-82M'),
  LLM_FALLBACK_CHAIN: z.string().default('huggingface,openai,selfhosted'),
  SELF_HOSTED_BASE_URL: z.string().default('http://localhost:11434/v1'),
  SELF_HOSTED_SPEECH_BASE_URL: z.string().default('http://localhost:8010/v1'),
  APP_STORAGE_ROOT: z.string().optional(),
  DEV_CONTENT_PATH: z.string().default(defaultDevContentPath),
  ADMIN_AUTH_PATH: z.string().default(defaultAdminAuthPath),
  MEDIA_UPLOADS_PATH: z.string().default(defaultMediaUploadsPath),
  ADMIN_SESSION_SECRET: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  HTTP_BODY_LIMIT_BYTES: z.coerce.number().default(26214400),
});

const parsedRawEnv = schema.parse(process.env);
const parsedEnv = {
  ...parsedRawEnv,
  DEV_CONTENT_PATH: resolveStoragePath(parsedRawEnv.APP_STORAGE_ROOT, 'content.json', parsedRawEnv.DEV_CONTENT_PATH),
  ADMIN_AUTH_PATH: resolveStoragePath(parsedRawEnv.APP_STORAGE_ROOT, 'admin-auth.json', parsedRawEnv.ADMIN_AUTH_PATH),
  MEDIA_UPLOADS_PATH: resolveStoragePath(parsedRawEnv.APP_STORAGE_ROOT, 'uploads', parsedRawEnv.MEDIA_UPLOADS_PATH),
};

if (parsedEnv.APP_ENV === 'production') {
  if (!parsedEnv.ADMIN_SESSION_SECRET || parsedEnv.ADMIN_SESSION_SECRET.length < 32 || parsedEnv.ADMIN_SESSION_SECRET === 'replace-with-a-long-random-production-secret') {
    throw new Error('ADMIN_SESSION_SECRET must be set to a strong non-placeholder value in production.');
  }

  const allowedOrigins = String(parsedEnv.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!allowedOrigins.length) {
    throw new Error('CORS_ALLOWED_ORIGINS must list at least one production web origin.');
  }

  const usesDefaultRepoStorage = [parsedEnv.DEV_CONTENT_PATH, parsedEnv.ADMIN_AUTH_PATH, parsedEnv.MEDIA_UPLOADS_PATH]
    .some((value) => [defaultDevContentPath, defaultAdminAuthPath, defaultMediaUploadsPath].includes(path.resolve(value)));
  if (usesDefaultRepoStorage) {
    throw new Error('APP_STORAGE_ROOT or explicit durable DEV_CONTENT_PATH, ADMIN_AUTH_PATH, and MEDIA_UPLOADS_PATH must be configured in production.');
  }

  if (parsedEnv.REDIS_URL === 'redis://localhost:6379') {
    throw new Error('REDIS_URL must point to production Redis in production.');
  }
}

export const env = parsedEnv;
export type AppEnv = typeof env;

