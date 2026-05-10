import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../../config/env';

const MAX_MEDIA_BACKUP_BYTES = Number(process.env.MEDIA_BACKUP_MAX_BYTES || 32 * 1024 * 1024);
const MAX_MEDIA_BACKUP_FILES = Number(process.env.MEDIA_BACKUP_MAX_FILES || 500);

function cleanBase64Payload(base64: string) {
  const normalized = String(base64 || '').trim();
  if (!normalized) {
    return '';
  }

  const dataUrlPrefix = /^data:[^,]+,/i;
  return dataUrlPrefix.test(normalized) ? normalized.replace(dataUrlPrefix, '') : normalized;
}

function buildBackupFileName(kind: 'content' | 'media') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `clearn-${kind}-backup-${timestamp}.json`;
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

function assertMediaBackupBudget(fileCount: number, byteCount: number) {
  if (fileCount > MAX_MEDIA_BACKUP_FILES) {
    throw new Error(`Media backup is too large: ${fileCount} files exceeds the ${MAX_MEDIA_BACKUP_FILES} file limit. Download or prune media manually, then try again.`);
  }

  if (byteCount > MAX_MEDIA_BACKUP_BYTES) {
    throw new Error(`Media backup is too large: ${byteCount} bytes exceeds the ${MAX_MEDIA_BACKUP_BYTES} byte limit. Download or prune media manually, then try again.`);
  }
}

async function listFilesRecursive(
  rootPath: string,
  basePath = rootPath,
  budget = { fileCount: 0, byteCount: 0 },
): Promise<Array<{ path: string; base64: string }>> {
  if (!existsSync(rootPath)) {
    return [];
  }

  const rootStat = await stat(rootPath);
  if (rootStat.isFile()) {
    budget.fileCount += 1;
    budget.byteCount += rootStat.size;
    assertMediaBackupBudget(budget.fileCount, budget.byteCount);
    return [{ path: path.relative(basePath, rootPath).replace(/\\/g, '/'), base64: (await readFile(rootPath)).toString('base64') }];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: Array<{ path: string; base64: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath, basePath, budget));
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      budget.fileCount += 1;
      budget.byteCount += fileStat.size;
      assertMediaBackupBudget(budget.fileCount, budget.byteCount);
      files.push({ path: path.relative(basePath, fullPath).replace(/\\/g, '/'), base64: (await readFile(fullPath)).toString('base64') });
    }
  }
  return files;
}

function safeRelativePath(value: string) {
  const relativePath = String(value || '').replace(/^[/\\]+/, '').replace(/\\/g, '/');
  if (!relativePath || relativePath.split('/').some((part) => part === '..')) {
    return '';
  }
  return relativePath;
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
      media: { included: false, note: 'Media files are excluded from this content backup. Use the separate media backup buttons.' },
    };

    return { fileName: buildBackupFileName('content'), bytes: Buffer.from(JSON.stringify(backup, null, 2), 'utf8') };
  }

  async createMediaBackup() {
    const uploadsPath = resolvePath(env.MEDIA_UPLOADS_PATH);
    const backup = {
      schema: 'clearn-media-backup-v1',
      createdAt: new Date().toISOString(),
      appEnv: env.APP_ENV,
      limits: { maxBytes: MAX_MEDIA_BACKUP_BYTES, maxFiles: MAX_MEDIA_BACKUP_FILES },
      uploads: await listFilesRecursive(uploadsPath),
    };

    return { fileName: buildBackupFileName('media'), bytes: Buffer.from(JSON.stringify(backup, null, 2), 'utf8') };
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
      const parsed = JSON.parse(await readFile(tempPath, 'utf8')) as { schema?: string; content?: unknown; adminAuth?: unknown };

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

      return { restored: true, restartRequired: false, restoredAt: new Date().toISOString(), fileCount, mediaRestored: false };
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async restoreMediaBackup(fileName: string, base64: string) {
    const cleanBase64 = cleanBase64Payload(base64);
    if (!cleanBase64) {
      throw new Error('Media backup archive is empty.');
    }

    const safeFileName = path.basename(String(fileName || 'clearn-media-backup.json')).replace(/[^A-Za-z0-9._-]/g, '-');
    const tempPath = path.join(os.tmpdir(), `${Date.now()}-${safeFileName || 'clearn-media-backup.json'}`);

    try {
      await writeFile(tempPath, Buffer.from(cleanBase64, 'base64'));
      const parsed = JSON.parse(await readFile(tempPath, 'utf8')) as { schema?: string; uploads?: Array<{ path: string; base64: string }> };
      if (parsed.schema !== 'clearn-media-backup-v1' && parsed.schema !== 'clearn-node-json-backup-v1') {
        throw new Error('Unsupported media backup schema. Choose a media backup JSON file.');
      }

      const uploadsPath = resolvePath(env.MEDIA_UPLOADS_PATH);
      await rm(uploadsPath, { recursive: true, force: true });
      await mkdir(uploadsPath, { recursive: true });
      let fileCount = 0;
      for (const file of parsed.uploads || []) {
        const relativePath = safeRelativePath(file.path);
        if (!relativePath) continue;
        const targetPath = path.join(uploadsPath, relativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, Buffer.from(String(file.base64 || ''), 'base64'));
        fileCount += 1;
      }

      return { restored: true, restartRequired: false, restoredAt: new Date().toISOString(), fileCount };
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
