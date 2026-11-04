import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

const replacements = new Map([
  ['@clearn/contracts', 'file:../../packages/contracts'],
  ['@clearn/domain', 'file:../../packages/domain'],
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

  if (relativePath === 'apps/client/package.json') {
    json.dependencies ||= {};

    if (!json.dependencies['expo-linking']) {
      json.dependencies['expo-linking'] = '~7.0.5';
      changed = true;
    }
  }

  if (changed) {
    await writeFile(packagePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    console.log(`[vercel] patched dependencies in ${relativePath}`);
  }
}

// npm does not read pnpm.overrides. Apply the same security resolutions on Vercel.
const platformManifestPath = path.join(root, 'package.json');
const platformManifest = JSON.parse(await readFile(platformManifestPath, 'utf8'));
platformManifest.overrides = platformManifest.pnpm?.overrides || {};
await writeFile(platformManifestPath, JSON.stringify(platformManifest, null, 2) + '\n', 'utf8');

await Promise.all([
  patchPackageJson('apps/client/package.json'),
  patchPackageJson('apps/api/package.json'),
  patchPackageJson('packages/contracts/package.json'),
]);
