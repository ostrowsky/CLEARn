import crypto from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MediaStore {
  upload(input: { fileName: string; base64: string }): Promise<{ url: string; fileName: string; size: number }>;
  delete(url: string): Promise<{ deleted: boolean; url: string }>;
}

function safeName(fileName: string): string {
  const extension = path.extname(fileName) || '.bin';
  const base = path.basename(fileName, extension).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${base || 'asset'}-${crypto.randomUUID().slice(0, 8)}${extension.toLowerCase()}`;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function getLocalUploadsRoot() {
  return path.resolve(currentDir, '../../../../../../web/static/uploads');
}

export function resolveLocalUploadPath(url: string) {
  if (!url.startsWith('/uploads/')) {
    return null;
  }

  const fileName = url.slice('/uploads/'.length);
  return path.join(getLocalUploadsRoot(), fileName);
}

export class LocalMediaStore implements MediaStore {
  private readonly root = getLocalUploadsRoot();

  async upload(input: { fileName: string; base64: string }): Promise<{ url: string; fileName: string; size: number }> {
    await mkdir(this.root, { recursive: true });
    const fileName = safeName(input.fileName);
    const payload = input.base64.replace(/^data:[^;]+;base64,/, '');
    const bytes = Buffer.from(payload, 'base64');
    await writeFile(path.join(this.root, fileName), bytes);
    return { url: `/uploads/${fileName}`, fileName, size: bytes.length };
  }

  async delete(url: string): Promise<{ deleted: boolean; url: string }> {
    if (!url.startsWith('/uploads/')) {
      return { deleted: false, url };
    }

    const fileName = url.slice('/uploads/'.length);
    await unlink(path.join(this.root, fileName)).catch(() => undefined);
    return { deleted: true, url };
  }
}
