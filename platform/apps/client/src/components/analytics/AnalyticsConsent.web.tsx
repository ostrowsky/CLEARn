import { useEffect, useState } from 'react';
import { usePathname } from 'expo-router';
import { analyticsAvailable, restoreAnalyticsConsent, setAnalyticsConsent, setAnalyticsPage, CONSENT_KEY, type AnalyticsConsent as Consent } from '../../lib/analytics';
import { apiClient } from '../../lib/api';
import { staticContent } from '../../lib/staticContent';
import { getNestedString, getUiConfig } from '../../lib/contentMeta';
import { getUiTextFontSize } from '../../lib/contentTypography';

export function AnalyticsConsent() {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [choice, setChoice] = useState<Consent>(null);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(staticContent);
  useEffect(() => {
    if (!analyticsAvailable()) return;
    setChoice(restoreAnalyticsConsent());
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === CONSENT_KEY || event.key === null) setChoice(restoreAnalyticsConsent());
    };
    window.addEventListener('storage', sync);
    let active = true;
    apiClient.getContent().then(value => { if (active) setContent(value); }).catch(() => {});
    return () => { active = false; window.removeEventListener('storage', sync); };
  }, []);
  useEffect(() => { if (ready) setAnalyticsPage(pathname); }, [pathname, ready]);
  if (!ready || /^\/admin(?:\/|$)/i.test(pathname)) return null;
  const ui = getUiConfig(content);
  const defaults = getUiConfig(staticContent);
  const copy = (key: string) => getNestedString(ui, ['analytics', key], getNestedString(defaults, ['analytics', key]));
  const font = (key: string, fallback: number) => getUiTextFontSize(ui, ['analytics', key]) || fallback;
  const choose = (value: 'granted' | 'denied') => { setAnalyticsConsent(value); setChoice(value); setEditing(false); };
  const button = { background: '#1c1c1c', color: '#f5f1ea', border: '1px solid #777', padding: '10px 16px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 };
  if (choice !== null && !editing) return (
    <button type="button" style={{ ...button, position: 'fixed', bottom: 12, right: 16, zIndex: 10000 }} onClick={() => setEditing(true)}>{copy('settings')}</button>
  );
  return (
    <section aria-label={copy('title')} style={{ position: 'fixed', bottom: 16, left: 16, right: 16, maxWidth: 540, maxHeight: '80vh', overflowY: 'auto', zIndex: 10000, background: '#131313', color: '#f5f1ea', border: '1px solid #777', borderRadius: 8, padding: 20, fontFamily: 'Manrope, system-ui, sans-serif', boxShadow: '0 4px 24px #0008' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: font('title', 18) }}>{copy('title')}</h2>
      <p style={{ margin: '0 0 16px', lineHeight: 1.5, fontSize: font('description', 14) }}>{copy('description')}</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...button, flex: 1 }} onClick={() => choose('granted')}>{copy('accept')}</button>
        <button type="button" style={{ ...button, flex: 1 }} onClick={() => choose('denied')}>{copy('decline')}</button>
        {editing ? <button type="button" style={button} onClick={() => setEditing(false)}>{copy('close')}</button> : null}
      </div>
    </section>
  );
}
