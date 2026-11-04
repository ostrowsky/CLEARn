import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Expo 52's CommonJS tooling predates the patched libraries' export shapes.
// Adapt only these two imports; the actual security-fixed implementations stay in use.
export async function prepareToolingCompat(platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const requireClient = createRequire(path.join(platformRoot, 'apps/client/package.json'));
  const patches = [
    {
      file: path.join(path.dirname(requireClient.resolve('metro/package.json')), 'src/Assets.js'),
      before: ['const getImageSize = require("image-size");', 'const getImageSize = require("image-size").imageSize;'],
      after: 'const getImageSize = input => require("image-size").imageSize(typeof input === "string" ? fs.readFileSync(input) : input);',
    },
    {
      file: requireClient.resolve('query-string'),
      before: "const decodeComponent = require('decode-uri-component');",
      after: "const decodeComponent = require('decode-uri-component').default;",
    },
  ];
  for (const { file, before, after } of patches) {
    const source = await readFile(file, 'utf8');
    if (source.includes(after)) continue;
    const original = (Array.isArray(before) ? before : [before]).find(value => source.includes(value));
    if (!original) throw new Error(`Review the tooling compatibility patch for ${file}: expected import was not found.`);
    await writeFile(file, source.replace(original, after), 'utf8');
    console.log(`[build-compat] updated ${path.relative(platformRoot, file)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareToolingCompat();
