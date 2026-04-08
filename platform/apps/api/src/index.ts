import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { env } from './config/env';
import { registerRoutes } from './routes/registerRoutes';

const app = Fastify({ logger: true, bodyLimit: env.HTTP_BODY_LIMIT_BYTES });

await app.register(cors, {
  origin: true,
  credentials: true,
});
await app.register(sensible);
await registerRoutes(app);

await app.listen({ port: env.APP_PORT, host: '0.0.0.0' });
app.log.info(`SOFTskills API listening on ${env.APP_BASE_URL}`);
