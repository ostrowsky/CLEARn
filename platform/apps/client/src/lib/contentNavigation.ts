import type { AppContent, ContentSection } from '@softskills/domain';

export function findSectionById(content: AppContent | null | undefined, id: string | undefined) {
  if (!content || !id) {
    return undefined;
  }

  return content.sections.find((section) => section.id === id);
}

export function findSectionByRoute(content: AppContent | null | undefined, route: string | undefined) {
  if (!content || !route) {
    return undefined;
  }

  return content.sections.find((section) => section.route === route);
}

export function getParentSection(content: AppContent | null | undefined, section: ContentSection | undefined) {
  if (!content || !section || !section.route || section.route === '/') {
    return undefined;
  }

  const parts = section.route.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return findSectionByRoute(content, '/');
  }

  return findSectionByRoute(content, `/${parts.slice(0, -1).join('/')}`);
}