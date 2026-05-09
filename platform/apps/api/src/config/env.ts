import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const defaultDevContentPath = path.resolve(configDir, '..', '..', '..', '..', '..', 'web', 'data', 'content.json');

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
  DEV_CONTENT_PATH: z.string().default(defaultDevContentPath),
  ADMIN_AUTH_PATH: z.string().default(path.resolve(configDir, '..', '..', '..', '..', '..', 'web', 'data', 'admin-auth.json')),
  ADMIN_SESSION_SECRET: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  HTTP_BODY_LIMIT_BYTES: z.coerce.number().default(26214400),
});

const parsedEnv = schema.parse(process.env);

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
}

export const env = parsedEnv;
export type AppEnv = typeof env;

