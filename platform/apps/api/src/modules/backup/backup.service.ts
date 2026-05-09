import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../../config/env';

function cleanBase64Payload(base64: string) {
  const normalized = String(base64 || '').trim();
  if (!normalized) {
    return '';
  }

  const dataUrlPrefix = /^data:[^,]+,/i;
  return dataUrlPrefix.test(normalized) ? normalized.replace(dataUrlPrefix, '') : normalized;
}

function buildBackupFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `clearn-content-backup-${timestamp}.json`;
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

async function readJsonFileIfExists(filePath: string) {
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export class BackupService {
  async createBackup() {
    const contentPath = resolvePath(env.DEV_CONTENT_PATH);
    const adminAuthPath = resolvePath(env.ADMIN_AUTH_PATH);

    const backup = {
      schema: 'clearn-content-backup-v1',
      createdAt: new Date().toISOString(),
      appEnv: env.APP_ENV,
      content: await readJsonFileIfExists(contentPath),
      adminAuth: await readJsonFileIfExists(adminAuthPath),
      media: {
        included: false,
        note: 'Media files are excluded from this content backup to avoid browser memory issues. Back up uploads separately from Render disk storage.',
      },
    };

    return {
      fileName: buildBackupFileName(),
      bytes: Buffer.from(JSON.stringify(backup, null, 2), 'utf8'),
    };
  }

  async restoreBackup(fileName: string, base64: string) {
    const cleanBase64 = cleanBase64Payload(base64);
    if (!cleanBase64) {
      throw new Error('Backup archive is empty.');
    }

    const safeFileName = path.basename(String(fileName || 'clearn-content-backup.json')).replace(/[^A-Za-z0-9._-]/g, '-');
    const tempPath = path.join(os.tmpdir(), `${Date.now()}-${safeFileName || 'clearn-content-backup.json'}`);

    try {
      await writeFile(tempPath, Buffer.from(cleanBase64, 'base64'));
      const parsed = JSON.parse(await readFile(tempPath, 'utf8')) as {
        schema?: string;
        content?: unknown;
        adminAuth?: unknown;
      };

      if (parsed.schema && parsed.schema !== 'clearn-content-backup-v1' && parsed.schema !== 'clearn-node-json-backup-v1') {
        throw new Error('Unsupported backup schema. Choose a content backup JSON file.');
      }

      let fileCount = 0;
      if (parsed.content) {
        const contentPath = resolvePath(env.DEV_CONTENT_PATH);
        await mkdir(path.dirname(contentPath), { recursive: true });
        await writeFile(contentPath, JSON.stringify(parsed.content, null, 2), 'utf8');
        fileCount += 1;
      }

      if (parsed.adminAuth) {
        const adminAuthPath = resolvePath(env.ADMIN_AUTH_PATH);
        await mkdir(path.dirname(adminAuthPath), { recursive: true });
        await writeFile(adminAuthPath, JSON.stringify(parsed.adminAuth, null, 2), 'utf8');
        fileCount += 1;
      }

      return {
        restored: true,
        restartRequired: false,
        restoredAt: new Date().toISOString(),
        fileCount,
        mediaRestored: false,
      };
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
