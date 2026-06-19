import { Platform } from 'react-native';

declare const document: {
  head?: { appendChild: (node: unknown) => void };
  createElement?: (tagName: string) => { id?: string; textContent?: string };
  getElementById?: (id: string) => unknown;
} | undefined;

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById?.('clearn-redesign-fonts')) {
  const style = document.createElement?.('style');
  if (style) {
    style.id = 'clearn-redesign-fonts';
    style.textContent = `
      @font-face { font-family: 'Instrument Serif'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/ff705a56-96a5-4d16-a57f-7b0252adca70.woff2') format('woff2'); }
      @font-face { font-family: 'Instrument Serif'; font-style: italic; font-weight: 400; font-display: swap; src: url('/fonts/9b1a0446-2f51-449a-a178-0d2013f9ab3b.woff2') format('woff2'); }
      @font-face { font-family: 'Manrope'; font-style: normal; font-weight: 200 800; font-display: swap; src: url('/fonts/1a993d68-7621-4b19-a7d0-c8d886c26a03.woff2') format('woff2'); }
      html, body, #root { background: #000000; color: #f5f1ea; overflow-x: hidden; }
      body { font-family: 'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
    `;
    document.head?.appendChild(style);
  }
}
