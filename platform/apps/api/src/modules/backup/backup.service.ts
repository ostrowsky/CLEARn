import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { env } from '../../config/env';

const MEDIA_BACKUP_SCHEMA = 'clearn-media-backup-v1';
const LEGACY_NODE_BACKUP_SCHEMA = 'clearn-node-json-backup-v1';
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

type ZipSourceFile = { path: string; absolutePath: string; size: number; crc32: number };
type ZipCentralEntry = ZipSourceFile & { offset: number; nameBytes: Buffer };

function updateCrc32(seed: number, chunk: Buffer) {
  let crc = seed;
  for (const byte of chunk) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

async function calculateFileCrc32(filePath: string) {
  let crc = 0xffffffff;
  for await (const chunk of createReadStream(filePath)) {
    crc = updateCrc32(crc, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function cleanBase64Payload(base64: string) {
  const normalized = String(base64 || '').trim();
  if (!normalized) {
    return '';
  }

  const dataUrlPrefix = /^data:[^,]+,/i;
  return dataUrlPrefix.test(normalized) ? normalized.replace(dataUrlPrefix, '') : normalized;
}

function buildBackupFileName(kind: 'content' | 'media', extension = 'json') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `clearn-${kind}-backup-${timestamp}.${extension}`;
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

async function listMediaFiles(rootPath: string, basePath = rootPath): Promise<Array<{ path: string; absolutePath: string; size: number }>> {
  if (!existsSync(rootPath)) {
    return [];
  }

  const rootStat = await stat(rootPath);
  if (rootStat.isFile()) {
    return [{ path: path.relative(basePath, rootPath).replace(/\\/g, '/'), absolutePath: rootPath, size: rootStat.size }];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: Array<{ path: string; absolutePath: string; size: number }> = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMediaFiles(fullPath, basePath));
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      files.push({ path: path.relative(basePath, fullPath).replace(/\\/g, '/'), absolutePath: fullPath, size: fileStat.size });
    }
  }
  return files;
}

async function prepareZipSourceFiles(rootPath: string): Promise<ZipSourceFile[]> {
  const files = await listMediaFiles(rootPath);
  return Promise.all(files.map(async (file) => ({ ...file, crc32: await calculateFileCrc32(file.absolutePath) })));
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function localFileHeader(file: ZipSourceFile, nameBytes: Buffer) {
  const { dosDate, dosTime } = dosDateTime();
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(file.crc32, 14);
  header.writeUInt32LE(file.size, 18);
  header.writeUInt32LE(file.size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes]);
}

function centralDirectoryHeader(file: ZipCentralEntry) {
  const { dosDate, dosTime } = dosDateTime();
  const header = Buffer.alloc(46);
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(dosTime, 12);
  header.writeUInt16LE(dosDate, 14);
  header.writeUInt32LE(file.crc32, 16);
  header.writeUInt32LE(file.size, 20);
  header.writeUInt32LE(file.size, 24);
  header.writeUInt16LE(file.nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(file.offset, 42);
  return Buffer.concat([header, file.nameBytes]);
}

function endOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralDirectorySize, 12);
  footer.writeUInt32LE(centralDirectoryOffset, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

async function* createZipStream(files: ZipSourceFile[]) {
  const centralEntries: ZipCentralEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.path, 'utf8');
    const header = localFileHeader(file, nameBytes);
    centralEntries.push({ ...file, offset, nameBytes });
    offset += header.length + file.size;
    yield header;

    for await (const chunk of createReadStream(file.absolutePath)) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;
  for (const entry of centralEntries) {
    const header = centralDirectoryHeader(entry);
    centralDirectorySize += header.length;
    yield header;
  }

  yield endOfCentralDirectory(centralEntries.length, centralDirectorySize, centralDirectoryOffset);
}

function isZipPayload(fileName: string, bytes: Buffer) {
  return fileName.toLowerCase().endsWith('.zip') || bytes.readUInt32LE(0) === ZIP_LOCAL_FILE_HEADER;
}

function extractStoredZipEntries(bytes: Buffer) {
  const files: Array<{ path: string; bytes: Buffer }> = [];
  let offset = 0;

  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === ZIP_LOCAL_FILE_HEADER) {
    const compressionMethod = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (compressionMethod !== 0) {
      throw new Error('Unsupported media backup ZIP compression. Use the media backup ZIP produced by CLEARn.');
    }
    if (dataEnd > bytes.length || compressedSize !== uncompressedSize) {
      throw new Error('Invalid media backup ZIP file.');
    }

    files.push({ path: bytes.subarray(nameStart, nameStart + nameLength).toString('utf8'), bytes: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd;
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
    const files = await prepareZipSourceFiles(uploadsPath);
    const stream = Readable.from(createZipStream(files));
    return { fileName: buildBackupFileName('media', 'zip'), stream };
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

      if (parsed.schema && parsed.schema !== 'clearn-content-backup-v1' && parsed.schema !== LEGACY_NODE_BACKUP_SCHEMA) {
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

    const payload = Buffer.from(cleanBase64, 'base64');
    const uploadsPath = resolvePath(env.MEDIA_UPLOADS_PATH);
    await rm(uploadsPath, { recursive: true, force: true });
    await mkdir(uploadsPath, { recursive: true });

    if (isZipPayload(fileName, payload)) {
      let fileCount = 0;
      for (const file of extractStoredZipEntries(payload)) {
        const relativePath = safeRelativePath(file.path);
        if (!relativePath) continue;
        const targetPath = path.join(uploadsPath, relativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, file.bytes);
        fileCount += 1;
      }
      return { restored: true, restartRequired: false, restoredAt: new Date().toISOString(), fileCount };
    }

    const parsed = JSON.parse(payload.toString('utf8')) as { schema?: string; uploads?: Array<{ path: string; base64: string }> };
    if (parsed.schema !== MEDIA_BACKUP_SCHEMA && parsed.schema !== LEGACY_NODE_BACKUP_SCHEMA) {
      throw new Error('Unsupported media backup schema. Choose a media backup ZIP or JSON file.');
    }

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
  }
}
