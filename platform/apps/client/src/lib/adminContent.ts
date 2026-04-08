import type { AppContent, ContentBlock, ContentMaterial, ContentSection } from '@softskills/domain';
import { getNestedString } from './contentMeta';

export type AdminSchemaDrafts = {
  taxonomies: string;
  defaults: string;
  sectionViews: string;
  blockRenderers: string;
  practiceScreens: string;
  blockGroups: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function buildTemplateRoute(prefix: string) {
  const cleanPrefix = String(prefix || '').trim();
  if (!cleanPrefix) {
    return `/new-${Date.now()}`;
  }

  return `${cleanPrefix.replace(/\/+$/, '')}/${Date.now()}`;
}

export function cloneContent<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function ensureAdminContentStructures(content: AppContent): AppContent {
  const next = cloneContent(content);

  if (!next.meta || typeof next.meta !== 'object') {
    next.meta = { appTitle: '', updatedAt: '' };
  }

  next.meta.ui = asRecord(next.meta.ui);
  next.meta.ui.admin = asRecord(asRecord(next.meta.ui).admin);

  const admin = asRecord(asRecord(next.meta.ui).admin);
  admin.taxonomies = asRecord(admin.taxonomies);
  admin.fieldLabels = asRecord(admin.fieldLabels);
  admin.actions = asRecord(admin.actions);
  admin.messages = asRecord(admin.messages);
  admin.templates = asRecord(admin.templates);
  admin.templates.sectionTypes = asRecord(asRecord(admin.templates).sectionTypes);

  next.meta.runtime = asRecord(next.meta.runtime);
  const runtime = asRecord(next.meta.runtime);
  runtime.defaults = asRecord(runtime.defaults);
  runtime.sectionViews = asRecord(runtime.sectionViews);
  runtime.blockRenderers = asRecord(runtime.blockRenderers);
  runtime.practiceScreens = asRecord(runtime.practiceScreens);
  runtime.blockGroups = asRecord(runtime.blockGroups);

  return next;
}

export function getAdminConfig(content: AppContent | null | undefined) {
  return asRecord(asRecord(content?.meta?.ui).admin);
}

export function getFeedbackConfig(content: AppContent | null | undefined) {
  return asRecord(asRecord(content?.meta?.ui).feedback);
}

export function getAdminText(content: AppContent | null | undefined, path: string[], fallback = '') {
  return getNestedString(getAdminConfig(content), path, fallback);
}

export function getTaxonomyLabels(content: AppContent | null | undefined, groupName: string) {
  return asRecord(asRecord(getAdminConfig(content).taxonomies)[groupName]);
}

export function getTaxonomyValues(content: AppContent | null | undefined, groupName: string) {
  return Object.keys(getTaxonomyLabels(content, groupName));
}

export function getTaxonomyDefault(content: AppContent | null | undefined, groupName: string, fallbackValue = '') {
  return getTaxonomyValues(content, groupName)[0] || fallbackValue;
}

function getSectionTypeTemplate(content: AppContent | null | undefined, sectionType: string) {
  return asRecord(asRecord(asRecord(getAdminConfig(content).templates).sectionTypes)[sectionType]);
}

export function createSchemaDrafts(content: AppContent): { metaDraft: string; schemaDrafts: AdminSchemaDrafts } {
  const next = ensureAdminContentStructures(content);
  const runtime = asRecord(next.meta.runtime);

  return {
    metaDraft: JSON.stringify(next.meta || {}, null, 2),
    schemaDrafts: {
      taxonomies: JSON.stringify(getAdminConfig(next).taxonomies || {}, null, 2),
      defaults: JSON.stringify(runtime.defaults || {}, null, 2),
      sectionViews: JSON.stringify(runtime.sectionViews || {}, null, 2),
      blockRenderers: JSON.stringify(runtime.blockRenderers || {}, null, 2),
      practiceScreens: JSON.stringify(runtime.practiceScreens || {}, null, 2),
      blockGroups: JSON.stringify(runtime.blockGroups || {}, null, 2),
    },
  };
}

function parseJsonDraft(text: string, label: string) {
  try {
    return JSON.parse(text || '{}') as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${reason}`);
  }
}

export function applyAdminDrafts(content: AppContent, metaDraft: string, schemaDrafts: AdminSchemaDrafts, labels?: Partial<Record<keyof AdminSchemaDrafts | 'meta', string>>) {
  const next = ensureAdminContentStructures({
    ...content,
    meta: parseJsonDraft(metaDraft, labels?.meta || '') as AppContent['meta'],
  });

  const admin = getAdminConfig(next);
  const runtime = asRecord(next.meta.runtime);
  admin.taxonomies = parseJsonDraft(schemaDrafts.taxonomies, labels?.taxonomies || '');
  runtime.defaults = parseJsonDraft(schemaDrafts.defaults, labels?.defaults || '');
  runtime.sectionViews = parseJsonDraft(schemaDrafts.sectionViews, labels?.sectionViews || '');
  runtime.blockRenderers = parseJsonDraft(schemaDrafts.blockRenderers, labels?.blockRenderers || '');
  runtime.practiceScreens = parseJsonDraft(schemaDrafts.practiceScreens, labels?.practiceScreens || '');
  runtime.blockGroups = parseJsonDraft(schemaDrafts.blockGroups, labels?.blockGroups || '');

  return next;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMaterialTemplate(content: AppContent | null | undefined): ContentMaterial {
  return {
    id: uid('material'),
    type: getTaxonomyDefault(content, 'materialTypes', ''),
    title: 'New material',
    body: '',
    url: '',
    alt: '',
    meta: {},
  };
}

export function createBlockTemplate(content: AppContent | null | undefined): ContentBlock {
  return {
    id: uid('block'),
    kind: getTaxonomyDefault(content, 'blockKinds', ''),
    title: '',
    description: '',
    route: '',
    materials: [],
  };
}

function createMaterialFromTemplate(content: AppContent | null | undefined, template: Record<string, unknown>): ContentMaterial {
  return {
    id: uid('material'),
    type: asString(template.type, getTaxonomyDefault(content, 'materialTypes', '')),
    title: asString(template.title),
    body: asString(template.body),
    url: asString(template.url),
    alt: asString(template.alt),
    meta: cloneContent(asRecord(template.meta)),
  };
}

function createBlockFromTemplate(content: AppContent | null | undefined, template: Record<string, unknown>): ContentBlock {
  const rawMaterials = Array.isArray(template.materials) ? template.materials : [];
  return {
    id: uid('block'),
    kind: asString(template.kind, getTaxonomyDefault(content, 'blockKinds', '')),
    title: asString(template.title),
    description: asString(template.description),
    route: asString(template.route),
    materials: rawMaterials.map((item) => createMaterialFromTemplate(content, asRecord(item))),
  };
}

export function applySectionTypeTemplate(content: AppContent | null | undefined, section: ContentSection, nextType: string): ContentSection {
  section.type = nextType;
  const template = getSectionTypeTemplate(content, nextType);
  if (!Object.keys(template).length) {
    return section;
  }

  if (!section.eyebrow) {
    section.eyebrow = asString(template.eyebrow);
  }
  if (!section.title) {
    section.title = asString(template.title);
  }
  if (!section.summary) {
    section.summary = asString(template.summary);
  }
  if (!section.route || /^\/new-\d+$/.test(section.route)) {
    section.route = buildTemplateRoute(asString(template.routePrefix));
  }

  if (section.blocks.length) {
    return section;
  }

  if (Array.isArray(template.blocks) && template.blocks.length > 0) {
    section.blocks = template.blocks.map((item) => createBlockFromTemplate(content, asRecord(item)));
    return section;
  }

  const blockKind = asString(template.blockKind, getTaxonomyDefault(content, 'blockKinds', ''));
  const materialType = asString(template.materialType, getTaxonomyDefault(content, 'materialTypes', ''));
  const acceptedAnswers = asStringArray(template.acceptedAnswers);

  const starterMaterial: ContentMaterial = {
    id: uid('material'),
    type: materialType,
    title: asString(template.materialTitle),
    body: asString(template.materialBody),
    url: '',
    alt: asString(template.materialAlt),
    meta: {
      statement: asString(template.statement),
      placeholder: asString(template.placeholder),
      clarification: asString(template.clarification),
      acceptedAnswers,
    },
  };

  const starterBlock: ContentBlock = {
    id: uid('block'),
    kind: blockKind,
    title: asString(template.blockTitle),
    description: asString(template.blockDescription),
    route: asString(template.blockRoute),
    materials: [starterMaterial],
  };

  section.blocks = [starterBlock];
  return section;
}

export function createSectionTemplate(content: AppContent | null | undefined): ContentSection {
  const section: ContentSection = {
    id: uid('section'),
    route: `/new-${Date.now()}`,
    type: getTaxonomyDefault(content, 'sectionTypes', ''),
    eyebrow: '',
    title: '',
    summary: '',
    blocks: [],
  };

  return applySectionTypeTemplate(content, section, section.type);
}

