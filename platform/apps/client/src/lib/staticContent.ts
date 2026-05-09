import type { AppContent } from '@softskills/domain';
import bundledContent from '../generated/content.snapshot.json';

export const staticContent = bundledContent as AppContent;

export function isAppContent(value: unknown): value is AppContent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const content = value as Partial<AppContent>;
  return Array.isArray(content.sections) && Boolean(content.meta && typeof content.meta === 'object');
}
