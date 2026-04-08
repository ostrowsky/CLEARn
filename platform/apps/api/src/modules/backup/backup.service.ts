import { execFile } from 'node:child_process';
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../../../../../..');
const platformRoot = path.join(projectRoot, 'platform');
const backupScriptPath = path.join(platformRoot, 'backup-app.ps1');
const restoreScriptPath = path.join(platformRoot, 'restore-app.ps1');
const powershellPath = 'powershell.exe';

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
  return `softskills-backup-${timestamp}.zip`;
}

async function runPowerShell(scriptPath: string, args: string[]) {
  const result = await execFileAsync(powershellPath, ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  return (result.stdout || '').trim();
}

export class BackupService {
  async createBackup() {
    const fileName = buildBackupFileName();
    const tempPath = path.join(os.tmpdir(), `${Date.now()}-${fileName}`);

    try {
      await runPowerShell(backupScriptPath, ['-ProjectRoot', projectRoot, '-OutputPath', tempPath, '-Overwrite']);
      const bytes = await readFile(tempPath);
      return { fileName, bytes };
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async restoreBackup(fileName: string, base64: string) {
    const cleanBase64 = cleanBase64Payload(base64);
    if (!cleanBase64) {
      throw new Error('Backup archive is empty.');
    }

    const safeFileName = path.basename(String(fileName || 'softskills-backup.zip')).replace(/[^A-Za-z0-9._-]/g, '-');
    const tempPath = path.join(os.tmpdir(), `${Date.now()}-${safeFileName || 'softskills-backup.zip'}`);
    const tempRestoreScriptPath = path.join(os.tmpdir(), `softskills-restore-script-${Date.now()}.ps1`);

    try {
      await writeFile(tempPath, Buffer.from(cleanBase64, 'base64'));
      await copyFile(restoreScriptPath, tempRestoreScriptPath);
      const rawResult = await runPowerShell(tempRestoreScriptPath, ['-ProjectRoot', projectRoot, '-BackupFile', tempPath]);
      const parsed = rawResult ? JSON.parse(rawResult) as { restored?: boolean; restartRequired?: boolean; restoredAt?: string; fileCount?: number } : {};
      return {
        restored: Boolean(parsed.restored),
        restartRequired: parsed.restartRequired !== false,
        restoredAt: parsed.restoredAt || new Date().toISOString(),
        fileCount: Number(parsed.fileCount || 0),
      };
    } finally {
      await rm(tempRestoreScriptPath, { force: true }).catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
