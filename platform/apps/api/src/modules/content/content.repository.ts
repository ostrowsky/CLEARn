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

function findRepoRoot(startDir: string): string {
  let current = startDir;

  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(current, 'web', 'data', 'content.json'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(startDir, '..');
}

const repoRoot = findRepoRoot(process.cwd());

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = asRecord(parent[key]);
  parent[key] = current;
  return current;
}

function copyMissingString(target: Record<string, unknown>, source: Record<string, unknown>, key: string) {
  if (typeof target[key] === 'string' && String(target[key]).trim()) {
    return false;
  }

  if (typeof source[key] !== 'string' || !String(source[key]).trim()) {
    return false;
  }

  target[key] = source[key];
  return true;
}

function findMaterialsById(content: AppContent): Map<string, Record<string, unknown>> {
  const materials = new Map<string, Record<string, unknown>>();
  for (const section of content.sections || []) {
    for (const block of section.blocks || []) {
      for (const material of block.materials || []) {
        if (material.id) {
          materials.set(material.id, material as unknown as Record<string, unknown>);
        }
      }
    }
  }
  return materials;
}

function mergeBundledContentDefaults(content: AppContent, bundledContent: AppContent): { content: AppContent; changed: boolean } {
  let changed = false;

  const targetMeta = asRecord(content.meta);
  const sourceMeta = asRecord(bundledContent.meta);
  const targetUi = ensureObject(targetMeta, 'ui');
  const sourceUi = asRecord(sourceMeta.ui);
  const targetAdmin = ensureObject(targetUi, 'admin');
  const sourceAdmin = asRecord(sourceUi.admin);

  for (const groupName of ['actions', 'messages', 'fieldLabels']) {
    const targetGroup = ensureObject(targetAdmin, groupName);
    const sourceGroup = asRecord(sourceAdmin[groupName]);
    for (const key of Object.keys(sourceGroup)) {
      if (copyMissingString(targetGroup, sourceGroup, key)) {
        changed = true;
      }
    }
  }

  const targetAuth = ensureObject(targetAdmin, 'auth');
  const sourceAuth = asRecord(sourceAdmin.auth);
  for (const key of Object.keys(sourceAuth)) {
    if (copyMissingString(targetAuth, sourceAuth, key)) {
      changed = true;
    }
  }

  const bundledMaterials = findMaterialsById(bundledContent);
  for (const material of findMaterialsById(content).values()) {
    const id = typeof material.id === 'string' ? material.id : '';
    const bundledMaterial = bundledMaterials.get(id);
    if (!bundledMaterial) {
      continue;
    }

    const targetMetaForMaterial = ensureObject(material, 'meta');
    const sourceMetaForMaterial = asRecord(bundledMaterial.meta);
    if (copyMissingString(targetMetaForMaterial, sourceMetaForMaterial, 'transcript')) {
      changed = true;
    }
  }

  content.meta = targetMeta as AppContent['meta'];
  return { content, changed };
}

export class FileSystemContentRepository implements ContentRepository {
  private readonly filePath = resolvePath(env.DEV_CONTENT_PATH);
  private readonly defaultContentPath = path.resolve(repoRoot, 'web', 'data', 'content.json');
  private readonly defaultUploadsPath = path.resolve(repoRoot, 'web', 'static', 'uploads');
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
      const parsed = JSON.parse(file) as AppContent;
      const bundled = JSON.parse(decodeJsonBuffer(await readFile(this.defaultContentPath))) as AppContent;
      const merged = mergeBundledContentDefaults(parsed, bundled);
      if (merged.changed) {
        await writeFile(this.filePath, JSON.stringify(merged.content, null, 2), 'utf8');
      }

      return merged.content;
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
