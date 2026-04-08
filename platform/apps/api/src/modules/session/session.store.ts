import Redis from 'ioredis';
import { env } from '../../config/env';

export interface PersistedSession {
  sessionId: string;
}

export interface SessionStore<TSession extends PersistedSession> {
  get(sessionId: string): Promise<TSession | null>;
  set(session: TSession): Promise<void>;
}

export class InMemorySessionStore<TSession extends PersistedSession> implements SessionStore<TSession> {
  private readonly store = new Map<string, TSession>();

  async get(sessionId: string): Promise<TSession | null> {
    return this.store.get(sessionId) ?? null;
  }

  async set(session: TSession): Promise<void> {
    this.store.set(session.sessionId, session);
  }
}

export class RedisSessionStore<TSession extends PersistedSession> implements SessionStore<TSession> {
  private readonly redis = new Redis(env.REDIS_URL);

  async get(sessionId: string): Promise<TSession | null> {
    const raw = await this.redis.get(`softskills:session:${sessionId}`);
    return raw ? (JSON.parse(raw) as TSession) : null;
  }

  async set(session: TSession): Promise<void> {
    await this.redis.set(`softskills:session:${session.sessionId}`, JSON.stringify(session), 'EX', 3600);
  }
}
