import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const htmlPath = path.join(process.cwd(), 'dist', 'index.html');
const analyticsScript = '<script defer src="/_vercel/insights/script.js"></script>';

const html = await readFile(htmlPath, 'utf8');

if (html.includes('/_vercel/insights/script.js')) {
  console.log('[vercel-analytics] analytics script already present in dist/index.html');
  process.exit(0);
}

if (!html.includes('</head>')) {
  throw new Error('[vercel-analytics] Cannot inject analytics script: dist/index.html has no </head> tag.');
}

const updatedHtml = html.replace('</head>', `    ${analyticsScript}\n  </head>`);
await writeFile(htmlPath, updatedHtml, 'utf8');
console.log('[vercel-analytics] injected analytics script into dist/index.html');
