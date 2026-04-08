import { useEffect, useState } from 'react';
import type { AppContent } from '@softskills/domain';
import { apiClient } from '../lib/api';

export function useContent() {
  const [content, setContent] = useState<AppContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void apiClient.logDebug('content', 'load:start');
    apiClient.getContent()
      .then((nextContent) => {
        setContent(nextContent);
        void apiClient.logDebug('content', 'load:success', {
          sectionCount: nextContent.sections.length,
          updatedAt: nextContent.meta.updatedAt,
        });
      })
      .catch((nextError: Error) => {
        setError(nextError.message);
        void apiClient.logDebug('content', 'load:error', { message: nextError.message });
      })
      .finally(() => setLoading(false));
  }, []);

  return { content, loading, error };
}
