import type { AppContent, ContentBlock, ContentMaterial, ContentSection } from '@softskills/domain';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getUiConfig(content: AppContent | null | undefined) {
  return asRecord(content?.meta?.ui);
}

export function getPracticeConfig(content: AppContent | null | undefined) {
  return asRecord(content?.meta?.practice);
}

export function getRuntimeConfig(content: AppContent | null | undefined) {
  return asRecord(content?.meta?.runtime);
}

export function getNestedRecord(source: Record<string, unknown>, path: string[]) {
  let current: Record<string, unknown> = source;
  for (const segment of path) {
    current = asRecord(current[segment]);
  }
  return current;
}

export function getNestedString(source: Record<string, unknown>, path: string[], fallback = ''): string {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return fallback;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' ? current : fallback;
}

export function getNestedNumber(source: Record<string, unknown>, path: string[], fallback = 0): number {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return fallback;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'number' && Number.isFinite(current) ? current : fallback;
}

export function getSectionByRoute(content: AppContent | null | undefined, route: string) {
  return content?.sections.find((section) => section.route === route);
}

export function getRuntimeDefaults(content: AppContent | null | undefined) {
  return getNestedRecord(getRuntimeConfig(content), ['defaults']);
}

export function getSectionViewConfig(content: AppContent | null | undefined, sectionType: string | undefined) {
  const defaults = getRuntimeDefaults(content);
  const sectionViews = getNestedRecord(getRuntimeConfig(content), ['sectionViews']);
  const config = asRecord(sectionType ? sectionViews[sectionType] : undefined);

  return {
    view: asString(config.view, asString(defaults.sectionView, 'practice')),
    cardLayout: asString(config.cardLayout, asString(defaults.cardLayout, 'route-grid')),
    primaryCardStrategy: asString(config.primaryCardStrategy, asString(defaults.primaryCardStrategy, 'none')),
    collapsible: asBoolean(config.collapsible, asBoolean(defaults.collapsible, true)),
    featuredBlockCount: asNumber(config.featuredBlockCount, asNumber(defaults.featuredBlockCount, 0)),
  };
}

export function getBlockRenderer(content: AppContent | null | undefined, blockKind: string | undefined) {
  const defaults = getRuntimeDefaults(content);
  const renderers = getNestedRecord(getRuntimeConfig(content), ['blockRenderers']);
  const mapped = blockKind ? renderers[blockKind] : undefined;
  return asString(mapped, asString(defaults.blockRenderer, 'generic'));
}

export function getBlocksByRenderer(content: AppContent | null | undefined, section: ContentSection | undefined, renderer: string) {
  return (section?.blocks ?? []).filter((block) => getBlockRenderer(content, block.kind) === renderer);
}

export function findFirstBlockByRenderer(content: AppContent | null | undefined, section: ContentSection | undefined, renderer: string) {
  return getBlocksByRenderer(content, section, renderer)[0];
}

export function getPracticeScreenConfig(content: AppContent | null | undefined, key: string) {
  return asRecord(getNestedRecord(getRuntimeConfig(content), ['practiceScreens'])[key]);
}

export function getBlockGroupConfig(content: AppContent | null | undefined, key: string) {
  return asRecord(getNestedRecord(getRuntimeConfig(content), ['blockGroups'])[key]);
}

export function fillRuntimeTemplate(template: string | undefined, values: Record<string, string | undefined>) {
  return String(template || '').replace(/\{([^}]+)\}/g, (_match, key) => values[key] ?? '');
}

export function matchRuntimeTemplate(template: string | undefined, value: string | undefined) {
  if (!template || !value) {
    return null;
  }

  const keys: string[] = [];
  const pattern = `^${escapeRegExp(template).replace(/\\\{([^}]+)\\\}/g, (_match, key) => {
    keys.push(key);
    return '([^/]+)';
  })}$`;
  const match = value.match(new RegExp(pattern));
  if (!match) {
    return null;
  }

  return keys.reduce<Record<string, string>>((accumulator, key, index) => {
    accumulator[key] = match[index + 1] || '';
    return accumulator;
  }, {});
}

export function findPracticeScreenForSection(content: AppContent | null | undefined, section: ContentSection | undefined, renderer: string) {
  const practiceScreens = getNestedRecord(getRuntimeConfig(content), ['practiceScreens']);

  for (const [key, rawConfig] of Object.entries(practiceScreens)) {
    const config = asRecord(rawConfig);
    if (asString(config.blockRenderer) !== renderer) {
      continue;
    }

    const staticRoute = asString(config.sectionRoute);
    if (staticRoute && section?.route === staticRoute) {
      return { key, config, params: {} as Record<string, string> };
    }

    const staticSectionType = asString(config.sectionType);
    if (staticSectionType && section?.type === staticSectionType) {
      return { key, config, params: {} as Record<string, string> };
    }

    const params = matchRuntimeTemplate(asString(config.sectionRouteTemplate), section?.route);
    if (params) {
      return { key, config, params };
    }
  }

  return undefined;
}

export function findFirstBlock(section: ContentSection | undefined, kind: ContentBlock['kind']) {
  return section?.blocks.find((block) => block.kind === kind);
}

export function getMaterialBodies(block: ContentBlock | undefined) {
  return (block?.materials ?? []).map((material: ContentMaterial) => material.body).filter(Boolean);
}

export function getMaterialByTitle(block: ContentBlock | undefined, title: string) {
  return (block?.materials ?? []).find((material) => material.title === title);
}
