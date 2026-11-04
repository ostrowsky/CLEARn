import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prepareToolingCompat } from '../../platform/scripts/prepare-tooling-compat.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const platform = path.join(root, 'platform');
const pkg = JSON.parse(await fs.readFile(path.join(platform, 'package.json'), 'utf8'));
const rootPkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const clientPkg = JSON.parse(await fs.readFile(path.join(platform, 'apps/client/package.json'), 'utf8'));
assert.ok(clientPkg.dependencies['query-string'], 'Expo Router URL parsing must not depend on an undeclared transitive query-string dependency');
assert.ok(clientPkg.dependencies['expo-linking'], 'Expo linking must be declared for both package managers');
assert.equal(rootPkg.engines.node, '22.x');
assert.equal(pkg.engines.node, '22.x');
const vercel = JSON.parse(await fs.readFile(path.join(root, 'vercel.json'), 'utf8'));
const preflight = path.join(platform, 'apps/client/scripts/verify-production-api-env.mjs');
const vercelEnv = { ...process.env, VERCEL: '1', VERCEL_URL: 'preview.clearn.test', ALLOW_STATIC_ONLY_PREVIEW: '0', ...vercel.build.env };
assert.equal(vercelEnv.EXPO_PUBLIC_API_BASE_URL, 'https://clearn-api.onrender.com');
assert.equal(spawnSync(process.execPath, [preflight], { env: vercelEnv }).status, 0, 'Git-tracked build env must pass the actual Vercel preflight');
assert.notEqual(spawnSync(process.execPath, [preflight], { env: { ...vercelEnv, EXPO_PUBLIC_API_BASE_URL: '' } }).status, 0, 'Missing API configuration must still be rejected');
assert.notEqual(spawnSync(process.execPath, [preflight], { env: { ...vercelEnv, EXPO_PUBLIC_API_BASE_URL: 'https://preview.clearn.test' } }).status, 0, 'Static frontend URL must still be rejected as an API');
await prepareToolingCompat(platform);
await prepareToolingCompat(platform);
const requireClient = createRequire(path.join(platform, 'apps/client/package.json'));
const assets = requireClient('metro/src/Assets');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmAAAAABJRU5ErkJggg==', 'base64');
assert.deepEqual(assets.getAssetSize('png', pixel, 'pixel.png'), { width: 1, height: 1 });
assert.deepEqual({ ...requireClient('query-string').parse('skill=ask%20a%20question&next=%2Fasking%2Finterrupt') }, { next: '/asking/interrupt', skill: 'ask a question' });
const temp = await fs.mkdtemp(path.join(platform, '.tmp-build-compat-'));
try {
  const imageFile = path.join(temp, 'pixel.png');
  await fs.writeFile(imageFile, pixel);
  const asset = await assets.getAssetData(imageFile, 'pixel.png', [], null, '/assets');
  assert.equal(asset.width, 1);
  assert.equal(asset.height, 1);
  await fs.writeFile(path.join(temp, 'package.json'), JSON.stringify(pkg));
  for (const relative of ['apps/client', 'apps/api', 'packages/contracts']) {
    await fs.mkdir(path.join(temp, relative), { recursive: true });
    await fs.writeFile(path.join(temp, relative, 'package.json'), JSON.stringify({ name: `test-${relative.replace('/', '-')}`, dependencies: { '@clearn/domain': 'workspace:*', '@clearn/contracts': 'workspace:*' } }));
  }
  await promisify(execFile)(process.execPath, [path.join(platform, 'scripts/prepare-vercel-npm-install.mjs')], { cwd: temp });
  const prepared = JSON.parse(await fs.readFile(path.join(temp, 'package.json'), 'utf8'));
  assert.deepEqual(prepared.overrides, pkg.pnpm.overrides, 'npm must apply the same security resolutions as pnpm');
  assert.deepEqual(prepared.pnpm, pkg.pnpm, 'npm preparation must preserve pnpm metadata');
  const client = JSON.parse(await fs.readFile(path.join(temp, 'apps/client/package.json'), 'utf8'));
  assert.equal(client.dependencies['@clearn/domain'], 'file:../../packages/domain');
  assert.equal(client.dependencies['expo-linking'], '~7.0.5');
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
// An npm installation can omit query-string entirely after a React Navigation update.
const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'clearn-build-compat-'));
try {
  await fs.mkdir(path.join(isolated, 'apps/client'), { recursive: true });
  await fs.mkdir(path.join(isolated, 'node_modules/metro/src'), { recursive: true });
  await fs.writeFile(path.join(isolated, 'apps/client/package.json'), JSON.stringify({ name: 'client-fixture' }));
  await fs.writeFile(path.join(isolated, 'node_modules/metro/package.json'), JSON.stringify({ name: 'metro', main: 'src/Assets.js' }));
  const assetModule = path.join(isolated, 'node_modules/metro/src/Assets.js');
  await fs.writeFile(assetModule, 'const getImageSize = require("image-size");');
  await prepareToolingCompat(isolated);
  await prepareToolingCompat(isolated);
  assert.match(await fs.readFile(assetModule, 'utf8'), /fs\.readFileSync/);
} finally {
  assert.equal(path.dirname(isolated), path.resolve(os.tmpdir()));
  await fs.rm(isolated, { recursive: true, force: true });
}
console.log('Build compatibility passed: Node 22 manifests, patched image decoding, URL parsing, idempotent adapters, and npm/pnpm resolution parity.');
