import type { AnalyticsConsent, ExerciseEvent, ExerciseType } from './analytics';
export type { AnalyticsConsent, ExerciseEvent, ExerciseType } from './analytics';
export const MEASUREMENT_ID = 'G-5EJ2691BS9';
export const CONSENT_KEY = 'clearn.analytics.consent.v1';
const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
const disableKey = 'ga-disable-' + MEASUREMENT_ID;
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
let consent: AnalyticsConsent = null;
let currentPath = '';
let lastPage = '';
let started = false;

function browser(): AnalyticsWindow | null {
  return typeof window !== 'undefined' && typeof document !== 'undefined' ? window : null;
}
export function analyticsAvailable() {
  const w = browser();
  return Boolean(w && ['clearn.me', 'www.clearn.me'].includes(w.location.hostname) && w.location.protocol === 'https:');
}
function setDisabled(value: boolean) {
  const w = browser();
  if (w) (w as unknown as Record<string, unknown>)[disableKey] = value;
}
export function getAnalyticsConsent(): AnalyticsConsent {
  try {
    const saved = JSON.parse(browser()?.localStorage.getItem(CONSENT_KEY) || 'null');
    if (saved && ['granted', 'denied'].includes(saved.choice) && typeof saved.at === 'number' && saved.at <= Date.now() && Date.now() - saved.at < MAX_AGE) {
      return saved.choice;
    }
  } catch { /* Storage can be disabled. Ask again instead of assuming consent. */ }
  return null;
}
function learnerPath(value: string) {
  if (!value) return '';
  const path = value.split(/[?#]/)[0].replace(/\/+/g, '/') || '/';
  if (!/^\/[a-z0-9/_-]*$/i.test(path) || /^\/admin(?:\/|$)/i.test(path)) return '';
  return path.length <= 300 ? path : '';
}
function safeLocation(path: string) {
  const w = browser()!;
  const url = new URL(path, w.location.origin);
  const source = new URL(w.location.href);
  // Only campaign codes, never arbitrary query values such as answers or email.
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const value = source.searchParams.get(key);
    if (value && /^[a-z0-9_.~-]{1,64}$/i.test(value)) url.searchParams.set(key, value);
  }
  return url.href;
}
function safeReferrer() {
  try {
    const url = new URL(document.referrer);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    return url.origin === browser()!.location.origin ? url.origin + learnerPath(url.pathname) : url.origin + '/';
  } catch { return ''; }
}
function command(...args: unknown[]) { try { browser()?.gtag?.(...args); } catch { /* Optional tracking must never interrupt learning. */ } }
function ensureTag() {
  if (started) return;
  const w = browser()!;
  started = true;
  w.dataLayer = w.dataLayer || [];
  w.gtag = function () { w.dataLayer!.push(arguments); };
  command('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  command('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  command('js', new Date());
  command('config', MEASUREMENT_ID, {
    send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    page_location: safeLocation(currentPath), page_referrer: safeReferrer(), page_title: currentPath,
  });
  if (document.getElementById('clearn-google-analytics')) return;
  const script = document.createElement('script');
  script.id = 'clearn-google-analytics';
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  script.onerror = () => { /* Analytics is optional; never affect the exercise. */ };
  document.head.appendChild(script);
}
function clearCookies() {
  const w = browser();
  if (!w) return;
  const host = w.location.hostname;
  try { for (const item of document.cookie.split(';')) {
    const name = item.trim().split('=')[0];
    if (!/^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/.test(name)) continue;
    for (const domain of ['', host, '.' + host, 'clearn.me', '.clearn.me']) {
      document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax; Secure' + (domain ? '; domain=' + domain : '');
    }
  } } catch { /* Cookies may be disabled. */ }
}
function applyConsent(choice: AnalyticsConsent, persist: boolean) {
  consent = choice;
  if (persist) { try { browser()?.localStorage.setItem(CONSENT_KEY, JSON.stringify({ choice, at: Date.now() })); } catch { /* Session-only consent. */ } }
  if (choice !== 'granted') {
    setDisabled(true);
    if (started) command('consent', 'update', { analytics_storage: 'denied' });
    if (browser()?.dataLayer) browser()!.dataLayer!.length = 0;
    clearCookies();
    started = false;
    lastPage = '';
    return;
  }
  if (started) command('consent', 'update', { analytics_storage: 'granted' });
  setAnalyticsPage(currentPath);
}
export function setAnalyticsConsent(choice: Exclude<AnalyticsConsent, null>) { applyConsent(choice, true); }
export function restoreAnalyticsConsent() { const saved = getAnalyticsConsent(); applyConsent(saved, false); return saved; }
export function setAnalyticsPage(pathname: string) {
  currentPath = learnerPath(pathname);
  if (!analyticsAvailable() || consent !== 'granted' || !currentPath) {
    setDisabled(true);
    if (!currentPath) lastPage = '';
    return;
  }
  setDisabled(false);
  ensureTag();
  const location = safeLocation(currentPath);
  if (location === lastPage) return;
  const referrer = lastPage || safeReferrer();
  command('set', { page_location: location, page_referrer: referrer, page_title: currentPath });
  command('event', 'page_view', { send_to: MEASUREMENT_ID, page_location: location, page_referrer: referrer, page_title: currentPath });
  lastPage = location;
}
export function trackExerciseEvent(event: ExerciseEvent, type: ExerciseType, correct?: boolean) {
  if (!analyticsAvailable() || consent !== 'granted' || !currentPath || !started) return;
  if (!['exercise_start', 'answer_check', 'hint_view'].includes(event) || !['clarification', 'ask_after_talk', 'question_formation'].includes(type)) return;
  const payload: Record<string, unknown> = { send_to: MEASUREMENT_ID, exercise_type: type, page_location: safeLocation(currentPath), page_title: currentPath };
  if (event === 'answer_check' && typeof correct === 'boolean') payload.correct = correct;
  command('event', event, payload);
}
