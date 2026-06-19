import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const baselineDir = process.env.VISUAL_BASELINE_DIR;
const screenDir = process.env.VISUAL_SCREEN_DIR;
const outputDir = process.env.VISUAL_OUTPUT_DIR || path.join(process.cwd(), 'visual-regression-output');
const baseUrl = (process.env.VISUAL_BASE_URL || 'http://localhost:8081').replace(/\/$/, '');
const maxDiffRatio = Number.parseFloat(process.env.VISUAL_MAX_DIFF_RATIO || '0.08');

if (!baselineDir || !fs.existsSync(baselineDir)) {
  throw new Error('VISUAL_BASELINE_DIR must point to extracted CLEARn.zip pixel-perfect/renders.');
}

const desktop = { width: 1440 };
const mobile = { width: 375 };

const cases = [
  { name: '01-desktop-home', baseline: '01-desktop-home.png', screen: '01-desktop-home.html', url: '/', ...desktop, height: 1320, waitMs: 1200 },
  {
    name: '02-desktop-menu',
    baseline: '02-desktop-menu.png',
    screen: '02-desktop-menu.html',
    url: '/',
    ...desktop,
    height: 900,
    waitMs: 1200,
    action: async (page) => {
      await openLearnerMenu(page, 'Desktop menu');
    },
  },
  { name: '03-desktop-asking-hub', baseline: '03-desktop-asking-hub.png', screen: '03-desktop-asking-hub.html', url: '/asking', ...desktop, height: 1080, waitMs: 1200 },
  { name: '04-desktop-1.1-interrupt', baseline: '04-desktop-1.1-interrupt.png', screen: '04-desktop-1.1-interrupt.html', url: '/asking/interrupt', ...desktop, height: 2080, waitMs: 1800 },
  { name: '05-desktop-1.2-after-talk', baseline: '05-desktop-1.2-after-talk.png', screen: '05-desktop-1.2-after-talk.html', url: '/asking/after-talk', ...desktop, height: 2160, waitMs: 1800 },
  { name: '06-desktop-1.3-drill', baseline: '06-desktop-1.3-drill.png', screen: '06-desktop-1.3-drill.html', url: '/asking/without-context', ...desktop, height: 1480, waitMs: 12000 },
  {
    name: '07-desktop-mixed-session',
    baseline: '07-desktop-mixed-session.png',
    screen: '07-desktop-mixed-session.html',
    url: '/practice/answering/mixed?sectionId=answering-mixed&blockId=answering-mixed-practice',
    ...desktop,
    height: 1880,
    waitMs: 1800,
    action: async (page) => {
      const start = page.getByText('Start 10-question session on new topic', { exact: true });
      if (await start.count()) {
        await start.click();
        await page.waitForTimeout(7000);
      }
    },
  },
  { name: '08-desktop-chat', baseline: '08-desktop-chat.png', screen: '08-desktop-chat.html', url: '/learning-chat', ...desktop, height: 900, waitMs: 1800 },
  { name: '09-mobile-home', baseline: '09-mobile-home.png', screen: '09-mobile-home.html', url: '/', ...mobile, height: 1100, waitMs: 1200 },
  {
    name: '10-mobile-menu',
    baseline: '10-mobile-menu.png',
    screen: '10-mobile-menu.html',
    url: '/',
    ...mobile,
    height: 812,
    waitMs: 1200,
    action: async (page) => {
      await openLearnerMenu(page, 'Mobile menu');
    },
  },
  { name: '11-mobile-asking-hub', baseline: '11-mobile-asking-hub.png', screen: '11-mobile-asking-hub.html', url: '/asking', ...mobile, height: 900, waitMs: 1200 },
  { name: '12-mobile-1.1-interrupt', baseline: '12-mobile-1.1-interrupt.png', screen: '12-mobile-1.1-interrupt.html', url: '/asking/interrupt', ...mobile, height: 1280, waitMs: 1800 },
  { name: '13-mobile-1.3-drill', baseline: '13-mobile-1.3-drill.png', screen: '13-mobile-1.3-drill.html', url: '/asking/without-context', ...mobile, height: 1080, waitMs: 12000 },
  {
    name: '14-mobile-mixed-session',
    baseline: '14-mobile-mixed-session.png',
    screen: '14-mobile-mixed-session.html',
    url: '/practice/answering/mixed?sectionId=answering-mixed&blockId=answering-mixed-practice',
    ...mobile,
    height: 1100,
    waitMs: 1800,
    action: async (page) => {
      const start = page.getByText('Start 10-question session on new topic', { exact: true });
      if (await start.count()) {
        await start.click();
        await page.waitForTimeout(7000);
      }
    },
  },
];

async function openLearnerMenu(page, label) {
  const selectors = [
    page.getByLabel('home-menu-button'),
    page.getByLabel('learner-menu-button'),
    page.getByText('ASK ANSWER chat', { exact: true }),
  ];
  for (const menuButton of selectors) {
    if (await menuButton.count()) {
      await menuButton.first().click();
      await page.waitForTimeout(500);
      break;
    }
  }
  const overlay = page.getByText('SKILLS', { exact: true });
  if (!(await overlay.count())) {
    throw new Error(`${label} visual case could not open learner menu overlay.`);
  }
}

async function verifyLearnerMenuHover(page) {
  const learnerRoutes = ['/asking', '/asking/interrupt', '/asking/after-talk'];
  await page.setViewportSize({ width: 1280, height: 720 });

  for (const route of learnerRoutes) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const menuButton = page.getByRole('button', { name: 'learner-menu-button' }).first();
    const buttonBefore = await menuButton.locator('[dir="auto"]').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
    await menuButton.hover();
    const buttonAfter = await menuButton.locator('[dir="auto"]').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
    const triggerLinesMovedToAccent = buttonAfter.length >= 2 && buttonAfter.every((color) => color === 'rgb(224, 122, 74)');
    if (!triggerLinesMovedToAccent) {
      throw new Error(`${route} learner menu trigger hover did not move all hamburger lines to accent. Before: ${buttonBefore.join(', ')}; after: ${buttonAfter.join(', ')}.`);
    }

    await menuButton.click();
    const askLink = page.getByRole('link', { name: 'learner-menu-word-ASK' });
    const before = await askLink.locator('[dir="auto"]').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
    await askLink.hover();
    const after = await askLink.locator('[dir="auto"]').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
    const indexMovedToAccent = after[0] !== before[0] && after[0] === 'rgb(224, 122, 74)';
    const wordMovedToInk = after[1] !== before[1] && after[1] === 'rgb(245, 241, 234)';
    if (!indexMovedToAccent || !wordMovedToInk) {
      throw new Error(`${route} learner menu word hover did not match the mockup colors. Before: ${before.join(', ')}; after: ${after.join(', ')}.`);
    }
  }
}

async function verifyLearnerInteractiveHover(page) {
  const hoverCases = [
    { route: '/asking', text: 'Interrupt and ask' },
    { route: '/asking/interrupt', text: 'Start recording' },
    { route: '/asking/after-talk', text: 'Generate short talk' },
  ];
  await page.setViewportSize({ width: 1280, height: 720 });

  for (const testCase of hoverCases) {
    await page.goto(`${baseUrl}${testCase.route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const label = page.getByText(testCase.text, { exact: true }).first();
    const interactive = label.locator('xpath=ancestor::*[@tabindex="0" or @role="button" or @role="link"][1]');
    if (!(await interactive.count())) {
      throw new Error(`${testCase.route} could not find an interactive hover target for "${testCase.text}".`);
    }

    const before = await interactive.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      border: getComputedStyle(node).borderColor,
      filter: getComputedStyle(node).filter,
      shadow: getComputedStyle(node).boxShadow,
    }));
    await interactive.hover();
    await page.waitForTimeout(220);
    const after = await interactive.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      border: getComputedStyle(node).borderColor,
      filter: getComputedStyle(node).filter,
      shadow: getComputedStyle(node).boxShadow,
    }));
    const changed =
      after.background !== before.background ||
      after.border !== before.border ||
      after.filter !== before.filter ||
      after.shadow !== before.shadow;
    if (!changed) {
      throw new Error(`${testCase.route} "${testCase.text}" did not show a visible hover state. Before: ${JSON.stringify(before)}; after: ${JSON.stringify(after)}.`);
    }
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pngSize(pngPath) {
  const image = PNG.sync.read(fs.readFileSync(pngPath));
  return { width: image.width, height: image.height };
}

function cropToSharedSize(actual, expected) {
  const width = Math.min(actual.width, expected.width);
  const height = Math.min(actual.height, expected.height);
  return { width, height };
}

function pixelDiff(actualPngPath, expectedPngPath) {
  const actual = PNG.sync.read(fs.readFileSync(actualPngPath));
  const expected = PNG.sync.read(fs.readFileSync(expectedPngPath));
  const { width, height } = cropToSharedSize(actual, expected);
  let different = Math.abs(actual.width * actual.height - expected.width * expected.height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ai = (actual.width * y + x) << 2;
      const ei = (expected.width * y + x) << 2;
      const dr = Math.abs(actual.data[ai] - expected.data[ei]);
      const dg = Math.abs(actual.data[ai + 1] - expected.data[ei + 1]);
      const db = Math.abs(actual.data[ai + 2] - expected.data[ei + 2]);
      const da = Math.abs(actual.data[ai + 3] - expected.data[ei + 3]);
      if (dr + dg + db + da > 72) {
        different += 1;
      }
    }
  }
  const total = Math.max(actual.width * actual.height, expected.width * expected.height);
  return {
    different,
    total,
    ratio: total ? different / total : 1,
    actualSize: `${actual.width}x${actual.height}`,
    expectedSize: `${expected.width}x${expected.height}`,
  };
}

async function resolveBaseline(page, testCase) {
  const providedBaselinePath = path.join(baselineDir, testCase.baseline);
  if (!fs.existsSync(providedBaselinePath)) {
    throw new Error(`Missing baseline: ${providedBaselinePath}`);
  }

  const providedSize = pngSize(providedBaselinePath);
  if (providedSize.width === testCase.width && providedSize.height === testCase.height) {
    return { path: providedBaselinePath, source: 'provided-png', size: `${providedSize.width}x${providedSize.height}` };
  }

  if (!screenDir) {
    throw new Error(
      `${testCase.baseline} is ${providedSize.width}x${providedSize.height}, expected ${testCase.width}x${testCase.height}. ` +
      'Set VISUAL_SCREEN_DIR to CLEARn.zip pixel-perfect/screens so the runner can regenerate exact-size reference PNGs.'
    );
  }

  const screenPath = path.join(screenDir, testCase.screen);
  if (!fs.existsSync(screenPath)) {
    throw new Error(`Missing baseline screen HTML: ${screenPath}`);
  }

  const generatedDir = path.join(outputDir, 'generated-baselines');
  ensureDir(generatedDir);
  const generatedPath = path.join(generatedDir, testCase.baseline);
  await page.setViewportSize({ width: testCase.width, height: testCase.height });
  await page.goto(pathToFileURL(screenPath).href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: generatedPath, fullPage: false });
  return {
    path: generatedPath,
    source: 'screen-html',
    size: `${testCase.width}x${testCase.height}`,
    providedPngSize: `${providedSize.width}x${providedSize.height}`,
  };
}

async function main() {
  ensureDir(outputDir);
  const launchOptions = process.env.PLAYWRIGHT_CHROME_CHANNEL === 'bundled'
    ? {}
    : { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || 'chrome' };
  const browser = await chromium.launch(launchOptions);
  const results = [];
  try {
    const page = await browser.newPage();
    const baselinePage = await browser.newPage();
    await verifyLearnerMenuHover(page);
    await verifyLearnerInteractiveHover(page);
    for (const testCase of cases) {
      const baseline = await resolveBaseline(baselinePage, testCase);
      await page.setViewportSize({ width: testCase.width, height: testCase.height });
      await page.goto(`${baseUrl}${testCase.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(testCase.waitMs);
      if (testCase.action) {
        await testCase.action(page);
      }
      const actualPath = path.join(outputDir, `${testCase.name}.actual.png`);
      await page.screenshot({ path: actualPath, fullPage: false });
      const diff = pixelDiff(actualPath, baseline.path);
      results.push({
        ...testCase,
        actualPath,
        baselinePath: baseline.path,
        baselineSource: baseline.source,
        baselineSourceSize: baseline.size,
        providedPngSize: baseline.providedPngSize,
        ...diff,
        passed: diff.ratio <= maxDiffRatio,
      });
    }
  } finally {
    await browser.close();
  }

  const reportPath = path.join(outputDir, 'visual-regression-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ baseUrl, maxDiffRatio, results }, null, 2));
  const failed = results.filter((result) => !result.passed);
  for (const result of results) {
    const percent = (result.ratio * 100).toFixed(2);
    const sourceNote = result.providedPngSize
      ? `, regenerated from ${result.baselineSource} because provided PNG is ${result.providedPngSize}`
      : `, baseline ${result.baselineSource}`;
    console.log(`${result.passed ? '[pass]' : '[fail]'} ${result.name}: ${percent}% different (${result.actualSize} vs ${result.expectedSize}${sourceNote})`);
  }
  console.log(`Visual regression report: ${reportPath}`);
  if (failed.length) {
    throw new Error(`${failed.length} visual regression case(s) exceeded VISUAL_MAX_DIFF_RATIO=${maxDiffRatio}.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
