import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(scriptDir, '..');
const workspaceRoot = resolve(clientRoot, '..', '..', '..');
const sourcePath = resolve(workspaceRoot, 'web', 'data', 'content.json');
const targetPath = resolve(clientRoot, 'src', 'generated', 'content.snapshot.json');

mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);
console.log(`Synced static content snapshot: ${targetPath}`);
