export type MaterialType = string;
export type BlockKind = string;
export type SectionType = string;

export type ContentMaterial = {
  id: string;
  type: MaterialType;
  title: string;
  body: string;
  url?: string;
  alt?: string;
  meta?: Record<string, unknown>;
};

export type ContentBlock = {
  id: string;
  kind: BlockKind;
  title: string;
  description: string;
  route?: string;
  materials: ContentMaterial[];
};

export type ContentSection = {
  id: string;
  route: string;
  type: SectionType;
  eyebrow?: string;
  title: string;
  summary?: string;
  blocks: ContentBlock[];
};

export type AppMeta = {
  appTitle: string;
  updatedAt: string;
  ui?: Record<string, unknown>;
  practice?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AppContent = {
  meta: AppMeta;
  sections: ContentSection[];
};
