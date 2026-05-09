import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../../../../..');

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
  return `softskills-backup-${timestamp}.json`;
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

async function listFilesRecursive(rootPath: string, basePath = rootPath): Promise<Array<{ path: string; base64: string }>> {
  if (!existsSync(rootPath)) {
    return [];
  }

  const rootStat = await stat(rootPath);
  if (rootStat.isFile()) {
    return [
      {
        path: path.relative(basePath, rootPath).replace(/\\/g, '/'),
        base64: (await readFile(rootPath)).toString('base64'),
      },
    ];
  }

  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: Array<{ path: string; base64: string }> = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath, basePath));
    } else if (entry.isFile()) {
      files.push({
        path: path.relative(basePath, fullPath).replace(/\\/g, '/'),
        base64: (await readFile(fullPath)).toString('base64'),
      });
    }
  }

  return files;
}

export class BackupService {
  async createBackup() {
    const contentPath = resolvePath(env.DEV_CONTENT_PATH);
    const adminAuthPath = resolvePath(env.ADMIN_AUTH_PATH);
    const uploadsPath = resolvePath(env.MEDIA_UPLOADS_PATH);

    const backup = {
      schema: 'clearn-node-json-backup-v1',
      createdAt: new Date().toISOString(),
      appEnv: env.APP_ENV,
      content: await readJsonFileIfExists(contentPath),
      adminAuth: await readJsonFileIfExists(adminAuthPath),
      uploads: await listFilesRecursive(uploadsPath),
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

    const safeFileName = path.basename(String(fileName || 'softskills-backup.json')).replace(/[^A-Za-z0-9._-]/g, '-');
    const tempPath = path.join(os.tmpdir(), `${Date.now()}-${safeFileName || 'softskills-backup.json'}`);

    try {
      await writeFile(tempPath, Buffer.from(cleanBase64, 'base64'));
      const parsed = JSON.parse(await readFile(tempPath, 'utf8')) as {
        content?: unknown;
        adminAuth?: unknown;
        uploads?: Array<{ path: string; base64: string }>;
      };

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

      if (Array.isArray(parsed.uploads)) {
        const uploadsPath = resolvePath(env.MEDIA_UPLOADS_PATH);
        await rm(uploadsPath, { recursive: true, force: true });
        await mkdir(uploadsPath, { recursive: true });

        for (const file of parsed.uploads) {
          const relativePath = String(file.path || '').replace(/^[/\\]+/, '');
          if (!relativePath || relativePath.includes('..')) {
            continue;
          }

          const targetPath = path.join(uploadsPath, relativePath);
          await mkdir(path.dirname(targetPath), { recursive: true });
          await writeFile(targetPath, Buffer.from(String(file.base64 || ''), 'base64'));
          fileCount += 1;
        }
      }

      return {
        restored: true,
        restartRequired: false,
        restoredAt: new Date().toISOString(),
        fileCount,
      };
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
