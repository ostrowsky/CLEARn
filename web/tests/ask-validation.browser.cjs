// Run after the web export: node web/tests/ask-validation.browser.cjs [https://deployment-host]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const { chromium } = createRequire(path.join(root, 'platform/apps/client/package.json'))('playwright');
const content = JSON.parse(fs.readFileSync(path.join(root, 'web/data/content.json'), 'utf8'));
const buttons = content.meta.ui.buttons;
const feedback = content.meta.practice;
const target = process.argv[2];
const output = path.join(root, 'tmp-platform-browser-ask');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ogg': 'audio/ogg' };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const dist = path.join(root, 'platform/apps/client/dist');
  const server = target ? null : http.createServer((req, res) => {
    if (req.url.startsWith('/_vercel/')) { res.writeHead(204).end(); return; }
    let file = path.resolve(dist, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = target || `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      const checkRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (/\/api\/practice\/[^/]+\/check(?:\?|$)/.test(request.url())) checkRequests.push(request.url()); });
      // The API is unavailable throughout these checks, including content/generation.
      await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': route.request().headers().origin || baseUrl, 'Access-Control-Allow-Credentials': 'true' }, body: 'Service Suspended' }));
      async function clickAndExpect(label, message, index = 0) {
        const started = Date.now();
        await page.getByText(label, { exact: true }).nth(index).click();
        try { await page.getByText(message, { exact: true }).first().waitFor({ timeout: 1500 }); } catch (error) { console.error((await page.locator('body').innerText()).slice(-3500)); throw error; }
        assert.equal(checkRequests.length, 0, 'Check answer must not send an API request');
        assert.ok(Date.now() - started < 1500, 'Feedback must not wait for the API timeout');
      }
      await page.goto(baseUrl + '/asking/interrupt', { waitUntil: 'networkidle', timeout: 60000 });
      if (!(await page.locator('textarea').count())) await page.getByText('You Want to Clarify the Missed Detail', { exact: true }).click();
      const clarify = content.sections.find(section => section.id === 'asking-interrupt').blocks.flatMap(block => block.materials || []).find(material => material.type === 'audio');
      await page.locator('textarea').first().fill('This is not a clarification question.');
      await clickAndExpect(buttons.checkAnswer, feedback.clarifyFeedback.mismatch);
      await page.locator('textarea').first().fill(clarify.meta.clarification);
      await clickAndExpect(buttons.checkAnswer, feedback.clarifyFeedback.accepted);
      await page.screenshot({ path: path.join(output, `clarification-${width}.png`), fullPage: true });
      results.push({ width, exercise: 'clarification', correctAccepted: true, incorrectRejected: true });

      await page.goto(baseUrl + '/asking/after-talk', { waitUntil: 'networkidle', timeout: 60000 });
      await page.locator('textarea').first().fill('The release readiness review for our API.');
      await page.getByText(buttons.generateShortTalk, { exact: true }).click();
      const detail = page.locator('textarea:not([readonly])').last();
      await page.getByText(buttons.reviewQuestion, { exact: true }).waitFor({ timeout: 10000 });
      await detail.fill('zxqwr');
      await clickAndExpect(buttons.reviewQuestion, feedback.askAfterFeedback.unclearDetail);
      await detail.fill('release timing');
      await clickAndExpect(buttons.reviewQuestion, feedback.askAfterFeedback.accepted);
      await page.screenshot({ path: path.join(output, `after-talk-${width}.png`), fullPage: true });
      results.push({ width, exercise: 'after-talk', correctAccepted: true, incorrectRejected: true });

      await page.goto(baseUrl + '/asking/without-context', { waitUntil: 'networkidle', timeout: 60000 });
      await page.locator('textarea').nth(1).waitFor({ timeout: 10000 });
      await page.locator('textarea').nth(1).fill('What they review?');
      await clickAndExpect(buttons.checkCorrectness, feedback.questionFormationFeedback.grammar, 1);
      await page.locator('textarea').nth(1).fill('What will they review?');
      await clickAndExpect(buttons.checkCorrectness, feedback.questionFormationFeedback.accepted, 1);
      await page.screenshot({ path: path.join(output, `question-formation-${width}.png`), fullPage: true });
      results.push({ width, exercise: 'question-formation', correctAccepted: true, incorrectRejected: true });
      assert.deepEqual(errors, [], 'No browser page errors');
      assert.deepEqual(checkRequests, [], 'No validation requests');
      await page.close();
    }
    console.log(JSON.stringify({ baseUrl, apiUnavailable: true, checkRequests: 0, results }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
