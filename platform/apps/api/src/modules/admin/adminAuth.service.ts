import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';

type AdminAuthRecord = {
  version: 1;
  login: string;
  recoveryEmail: string;
  passwordSalt: string;
  passwordHash: string;
  passwordIterations: number;
  createdAt: string;
  updatedAt: string;
};

type SessionRecord = {
  login: string;
  expiresAt: number;
};

const passwordIterations = 210000;
const sessionCookieName = 'softskills_admin_session';
const sessionTtlMs = 1000 * 60 * 60 * 12;
const sessions = new Map<string, SessionRecord>();

function cleanText(value: unknown) {
  return String(value || '').trim();
}

function assertSetupInput(login: string, password: string, confirmPassword: string, recoveryEmail: string) {
  if (!login || !password || !confirmPassword || !recoveryEmail) {
    throw new Error('Login, password, password confirmation, and recovery email are required.');
  }

  if (password !== confirmPassword) {
    throw new Error('Password confirmation does not match.');
  }

  if (password.length < 8) {
    throw new Error('Password must contain at least 8 characters.');
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recoveryEmail)) {
    throw new Error('Recovery email must be a valid email address.');
  }
}

function getSessionSecret() {
  return env.ADMIN_SESSION_SECRET || `dev-session-secret:${env.ADMIN_AUTH_PATH}`;
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, passwordIterations, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function timingSafeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSessionId(sessionId: string) {
  return crypto.createHmac('sha256', getSessionSecret()).update(sessionId).digest('hex');
}

function encodeSessionCookie(sessionId: string) {
  return `${sessionId}.${signSessionId(sessionId)}`;
}

function decodeSessionCookie(value: string) {
  const [sessionId, signature] = String(value || '').split('.');
  if (!sessionId || !signature) {
    return '';
  }

  const expected = signSessionId(sessionId);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return '';
  }

  return sessionId;
}

function parseCookieHeader(cookieHeader: string | undefined) {
  const cookies = new Map<string, string>();
  for (const part of String(cookieHeader || '').split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key) {
      cookies.set(key, decodeURIComponent(value));
    }
  }
  return cookies;
}

function buildCookie(value: string, maxAgeSeconds: number) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (env.APP_ENV === 'production' || env.APP_BASE_URL.startsWith('https://')) {
    parts.push('SameSite=None', 'Secure');
  } else {
    parts.push('SameSite=Lax');
  }

  return parts.join('; ');
}

export class AdminAuthService {
  readonly cookieName = sessionCookieName;

  async isConfigured() {
    return Boolean(await this.readAuthRecord());
  }

  async getStatus(cookieHeader?: string) {
    const configured = await this.isConfigured();
    const session = configured ? this.getSession(cookieHeader) : null;
    return {
      configured,
      authenticated: Boolean(session),
      login: session?.login || '',
    };
  }

  async setup(input: { login?: unknown; password?: unknown; confirmPassword?: unknown; recoveryEmail?: unknown }) {
    if (await this.isConfigured()) {
      throw new Error('Admin account is already configured.');
    }

    const login = cleanText(input.login);
    const password = String(input.password || '');
    const confirmPassword = String(input.confirmPassword || '');
    const recoveryEmail = cleanText(input.recoveryEmail).toLowerCase();
    assertSetupInput(login, password, confirmPassword, recoveryEmail);

    const hashed = hashPassword(password);
    const now = new Date().toISOString();
    const record: AdminAuthRecord = {
      version: 1,
      login,
      recoveryEmail,
      passwordSalt: hashed.salt,
      passwordHash: hashed.hash,
      passwordIterations,
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(path.dirname(env.ADMIN_AUTH_PATH), { recursive: true });
    await writeFile(env.ADMIN_AUTH_PATH, JSON.stringify(record, null, 2), 'utf8');
    return this.createSession(login);
  }

  async login(input: { login?: unknown; password?: unknown }) {
    const record = await this.readAuthRecord();
    if (!record) {
      throw new Error('Admin account is not configured.');
    }

    const login = cleanText(input.login);
    const password = String(input.password || '');
    const expected = crypto.pbkdf2Sync(password, record.passwordSalt, record.passwordIterations || passwordIterations, 64, 'sha512').toString('hex');
    if (login !== record.login || !timingSafeEqualHex(expected, record.passwordHash)) {
      throw new Error('Invalid admin login or password.');
    }

    return this.createSession(record.login);
  }

  logout(cookieHeader?: string) {
    const sessionId = this.getSessionId(cookieHeader);
    if (sessionId) {
      sessions.delete(sessionId);
    }
    return { clearedCookie: buildCookie('', 0) };
  }

  getSession(cookieHeader?: string) {
    const sessionId = this.getSessionId(cookieHeader);
    if (!sessionId) {
      return null;
    }

    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  async resetForTests() {
    sessions.clear();
    await rm(env.ADMIN_AUTH_PATH, { force: true }).catch(() => undefined);
  }

  private async readAuthRecord() {
    try {
      const raw = await readFile(env.ADMIN_AUTH_PATH, 'utf8');
      const parsed = JSON.parse(raw) as AdminAuthRecord;
      return parsed?.login && parsed?.passwordHash && parsed?.passwordSalt ? parsed : null;
    } catch {
      return null;
    }
  }

  private getSessionId(cookieHeader?: string) {
    const rawCookie = parseCookieHeader(cookieHeader).get(sessionCookieName);
    return rawCookie ? decodeSessionCookie(rawCookie) : '';
  }

  private createSession(login: string) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, { login, expiresAt: Date.now() + sessionTtlMs });
    return {
      configured: true,
      authenticated: true,
      login,
      cookie: buildCookie(encodeSessionCookie(sessionId), Math.floor(sessionTtlMs / 1000)),
    };
  }
}
