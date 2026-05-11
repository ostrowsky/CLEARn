import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { env } from './config/env';
import { registerRoutes } from './routes/registerRoutes';
import { registerMediaBackupRoutes } from './routes/registerMediaBackupRoutes';
import { registerVideoTranscriptSegmentRoutes } from './routes/registerVideoTranscriptSegmentRoutes';

const app = Fastify({ logger: true, bodyLimit: env.HTTP_BODY_LIMIT_BYTES });

function getCorsOrigin() {
  if (env.APP_ENV !== 'production') {
    return true;
  }

  return String(env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

await app.register(cors, {
  origin: getCorsOrigin(),
  credentials: true,
});
await app.register(sensible);
await registerRoutes(app);
await registerVideoTranscriptSegmentRoutes(app);
await registerMediaBackupRoutes(app);

await app.listen({ port: env.APP_PORT, host: '0.0.0.0' });
app.log.info(`SOFTskills API listening on ${env.APP_BASE_URL}`);
