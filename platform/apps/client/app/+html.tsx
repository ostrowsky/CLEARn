import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/react';

export default function RootHtml({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <ScrollViewStyleReset />
        <script defer src="/_vercel/insights/script.js" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
