import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const replacements = new Map([
  ['@softskills/contracts', 'file:../../packages/contracts'],
  ['@softskills/domain', 'file:../../packages/domain'],
]);

async function patchPackageJson(relativePath) {
  const packagePath = path.join(root, relativePath);
  const raw = await readFile(packagePath, 'utf8');
  const json = JSON.parse(raw);
  let changed = false;

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = json[field];
    if (!deps || typeof deps !== 'object') continue;

    for (const [name, fileSpec] of replacements) {
      if (deps[name] === 'workspace:*') {
        deps[name] = fileSpec;
        changed = true;
      }
    }
  }

  if (changed) {
    await writeFile(packagePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    console.log(`[vercel] patched workspace deps in ${relativePath}`);
  }
}

await Promise.all([
  patchPackageJson('apps/client/package.json'),
  patchPackageJson('apps/api/package.json'),
  patchPackageJson('packages/contracts/package.json'),
]);
