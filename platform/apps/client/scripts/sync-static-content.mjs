import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(clientRoot, '..', '..', '..');
const sourcePath = resolve(workspaceRoot, 'web', 'data', 'content.json');
const targetPath = resolve(clientRoot, 'src', 'generated', 'content.snapshot.json');
const sourceUploadsPath = resolve(workspaceRoot, 'web', 'static', 'uploads');
const targetUploadsPath = resolve(clientRoot, 'public', 'uploads');

mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);
console.log(`Synced static content snapshot: ${targetPath}`);

if (existsSync(sourceUploadsPath)) {
  rmSync(targetUploadsPath, { recursive: true, force: true });
  mkdirSync(dirname(targetUploadsPath), { recursive: true });
  cpSync(sourceUploadsPath, targetUploadsPath, { recursive: true });
  console.log(`Synced static upload assets: ${targetUploadsPath}`);
}
