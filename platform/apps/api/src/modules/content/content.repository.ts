import { readFile, writeFile } from 'node:fs/promises';
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

export class FileSystemContentRepository implements ContentRepository {
  private readonly filePath = path.isAbsolute(env.DEV_CONTENT_PATH)
    ? env.DEV_CONTENT_PATH
    : path.resolve(process.cwd(), env.DEV_CONTENT_PATH);

  async get(): Promise<AppContent> {
    const file = decodeJsonBuffer(await readFile(this.filePath));

    try {
      return JSON.parse(file) as AppContent;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse content file at ${this.filePath}: ${reason}`);
    }
  }

  async save(content: AppContent): Promise<AppContent> {
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
