import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppContent } from '@softskills/domain';
import { env } from '../../config/env';

export interface ContentRepository {
  get(): Promise<AppContent>;
  save(content: AppContent): Promise<AppContent>;
}

function decodeJsonBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }

  return buffer.toString('utf8');
}

function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export class FileSystemContentRepository implements ContentRepository {
  private readonly filePath = resolvePath(env.DEV_CONTENT_PATH);
  private readonly defaultContentPath = path.resolve(process.cwd(), '..', '..', 'web', 'data', 'content.json');
  private readonly defaultUploadsPath = path.resolve(process.cwd(), '..', '..', 'web', 'static', 'uploads');
  private readonly mediaUploadsPath = resolvePath(env.MEDIA_UPLOADS_PATH);

  private async ensureStorageSeeded(): Promise<void> {
    if (existsSync(this.filePath)) {
      return;
    }

    mkdirSync(path.dirname(this.filePath), { recursive: true });
    await copyFile(this.defaultContentPath, this.filePath);

    if (!existsSync(this.mediaUploadsPath) && existsSync(this.defaultUploadsPath)) {
      mkdirSync(path.dirname(this.mediaUploadsPath), { recursive: true });
      await cp(this.defaultUploadsPath, this.mediaUploadsPath, { recursive: true });
    }
  }

  async get(): Promise<AppContent> {
    await this.ensureStorageSeeded();
    const file = decodeJsonBuffer(await readFile(this.filePath));

    try {
      return JSON.parse(file) as AppContent;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse content file at ${this.filePath}: ${reason}`);
    }
  }

  async save(content: AppContent): Promise<AppContent> {
    await this.ensureStorageSeeded();
    const next = {
      ...content,
      meta: {
        ...content.meta,
        updatedAt: new Date().toISOString(),
      },
    } satisfies AppContent;

    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
}
