import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import type { AnsweringMode, AppContent, ContentBlock, ContentMaterial } from '@softskills/domain';
import { Screen } from '../src/components/Screen';
import {
  type AdminSchemaDrafts,
  applyAdminDrafts,
  applySectionTypeTemplate,
  cloneContent,
  createBlockTemplate,
  createMaterialTemplate,
  createSchemaDrafts,
  createSectionTemplate,
  ensureAdminContentStructures,
  getAdminConfig,
  getAdminText,
  getFeedbackConfig,
  getTaxonomyLabels,
  getTaxonomyValues,
} from '../src/lib/adminContent';
import { apiClient, resolveApiUrl } from '../src/lib/api';
import { getNestedString } from '../src/lib/contentMeta';
import { tokens } from '../src/theme/tokens';

const EMPTY_SCHEMA_DRAFTS: AdminSchemaDrafts = {
  taxonomies: '',
  defaults: '',
  sectionViews: '',
  blockRenderers: '',
  practiceScreens: '',
  blockGroups: '',
};

function ensureMaterialMeta(material: ContentMaterial) {
  if (!material.meta || typeof material.meta !== 'object') {
    material.meta = {};
  }

  return material.meta as Record<string, unknown>;
}

function readMaterialMetaString(material: ContentMaterial, key: string) {
  return typeof asRecord(material.meta)[key] === 'string' ? String(asRecord(material.meta)[key]) : '';
}

function readMaterialMetaLines(material: ContentMaterial, key: string) {
  const value = asRecord(material.meta)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(String.fromCharCode(10))
    : '';
}

function isClarifyAudioMaterial(block: ContentBlock, material: ContentMaterial) {
  return block.kind === 'practice-clarify' && material.type === 'audio';
}

type StatusTone = 'success' | 'error';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length || fromIndex === toIndex) {
    return items;
  }

  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

const ANSWERING_REACTION_TYPES: AnsweringMode[] = ['good', 'difficult', 'unnecessary', 'irrelevant'];

function isAnsweringPracticeBlock(block: ContentBlock) {
  return block.kind === 'practice-answering';
}

function readAnsweringQuestionTypeConfig(content: AppContent | null, type: AnsweringMode) {
  return asRecord(asRecord(asRecord(asRecord(content?.meta).practice).answeringSession).questionTypes)[type] ? asRecord(asRecord(asRecord(asRecord(content?.meta).practice).answeringSession).questionTypes)[type] : {};
}

function readAnsweringReactionOptions(content: AppContent | null, type: AnsweringMode) {
  const value = asRecord(readAnsweringQuestionTypeConfig(content, type)).reactionOptions;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      const id = typeof record.id === 'string' ? record.id : '';
      const text = typeof record.text === 'string' ? record.text : '';
      const preferred = typeof record.preferred === 'boolean' ? record.preferred : true;
      return id ? { id, text, preferred } : null;
    })
    .filter((item): item is { id: string; text: string; preferred: boolean } => Boolean(item));
}

function ensureAnsweringQuestionTypeConfig(draft: AppContent, type: AnsweringMode) {
  if (!draft.meta || typeof draft.meta !== 'object') {
    draft.meta = {};
  }

  const meta = draft.meta as Record<string, unknown>;
  if (!meta.practice || typeof meta.practice !== 'object') {
    meta.practice = {};
  }

  const practice = meta.practice as Record<string, unknown>;
  if (!practice.answeringSession || typeof practice.answeringSession !== 'object') {
    practice.answeringSession = {};
  }

  const answeringSession = practice.answeringSession as Record<string, unknown>;
  if (!answeringSession.questionTypes || typeof answeringSession.questionTypes !== 'object') {
    answeringSession.questionTypes = {};
  }

  const questionTypes = answeringSession.questionTypes as Record<string, unknown>;
  const current = asRecord(questionTypes[type]);
  const next = {
    selectorLabel: typeof current.selectorLabel === 'string' ? current.selectorLabel : '',
    reactionOptions: Array.isArray(current.reactionOptions) ? current.reactionOptions : [],
    fallbackQuestions: Array.isArray(current.fallbackQuestions) ? current.fallbackQuestions : [],
    label: typeof current.label === 'string' ? current.label : '',
  };
  questionTypes[type] = next;
  return next as Record<string, unknown>;
}

function ensureSelectedSectionId(content: AppContent | null, currentId: string) {
  if (!content?.sections.length) {
    return '';
  }

  if (content.sections.some((section) => section.id === currentId)) {
    return currentId;
  }

  return content.sections[0]?.id || '';
}

async function pickWebFileAsBase64(accept = '') {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return null;
  }

  return await new Promise<{ fileName: string; base64: string } | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) {
      input.accept = accept;
    }
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve({ fileName: file.name, base64: String(reader.result || '') });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function openExternal(url: string) {
  if (!url) {
    return;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  void Linking.openURL(url);
}

function StatusBanner({ text, tone }: { text: string; tone: StatusTone }) {
  if (!text) {
    return null;
  }

  return (
    <View style={[styles.statusCard, tone === 'error' ? styles.statusError : styles.statusSuccess]}>
      <Text style={[styles.statusText, tone === 'error' ? styles.statusTextError : styles.statusTextSuccess]}>{text}</Text>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function ChoiceChips({
  values,
  currentValue,
  labels,
  onPick,
}: {
  values: string[];
  currentValue: string;
  labels: Record<string, unknown>;
  onPick: (value: string) => void;
}) {
  if (!values.length) {
    return null;
  }

  return (
    <View style={styles.choiceRow}>
      {values.map((value) => (
        <Pressable
          key={value}
          style={[styles.choiceChip, currentValue === value ? styles.choiceChipActive : null]}
          onPress={() => onPick(value)}
        >
          <Text style={[styles.choiceText, currentValue === value ? styles.choiceTextActive : null]}>
            {String(labels[value] || value)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function SchemaCard({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.schemaCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardHint}>{hint}</Text>
      <TextInput multiline value={value} onChangeText={onChange} style={[styles.input, styles.jsonInput]} />
    </View>
  );
}

export default function AdminScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 1080;
  const [content, setContent] = useState<AppContent | null>(null);
  const contentRef = useRef<AppContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<StatusTone>('success');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [metaDraft, setMetaDraft] = useState('');
  const [schemaDrafts, setSchemaDrafts] = useState<AdminSchemaDrafts>(EMPTY_SCHEMA_DRAFTS);

  async function loadAdminContent() {
    setLoading(true);
    setError('');

    try {
      const nextContent = ensureAdminContentStructures(await apiClient.getAdminContent());
      const drafts = createSchemaDrafts(nextContent);
      contentRef.current = nextContent;
      setContent(nextContent);
      setMetaDraft(drafts.metaDraft);
      setSchemaDrafts(drafts.schemaDrafts);
      setSelectedSectionId((currentId) => ensureSelectedSectionId(nextContent, currentId));
      setMessage('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdminContent();
  }, []);

  const adminConfig = getAdminConfig(content);
  const feedbackConfig = getFeedbackConfig(content);
  const fieldLabels = asRecord(adminConfig.fieldLabels);
  const actions = asRecord(adminConfig.actions);
  const messages = asRecord(adminConfig.messages);
  const sectionTypeLabels = getTaxonomyLabels(content, 'sectionTypes');
  const blockKindLabels = getTaxonomyLabels(content, 'blockKinds');
  const materialTypeLabels = getTaxonomyLabels(content, 'materialTypes');
  const selectedSection = content?.sections.find((section) => section.id === selectedSectionId) || null;

  function setStatus(text: string, tone: StatusTone = 'success') {
    setMessage(text);
    setMessageTone(tone);
  }

  function updateContent(mutator: (draft: AppContent) => void) {
    setContent((current) => {
      if (!current) {
        return current;
      }

      const next = cloneContent(current);
      mutator(next);
      contentRef.current = next;
      return next;
    });
  }

  function updateMetaContent(mutator: (draft: AppContent) => void) {
    setContent((current) => {
      if (!current) {
        return current;
      }

      const next = cloneContent(current);
      mutator(next);
      contentRef.current = next;
      setMetaDraft(JSON.stringify(next.meta || {}, null, 2));
      return next;
    });
  }
  function updateSectionType(sectionId: string, value: string) {
    updateContent((draft) => {
      const target = draft.sections.find((item) => item.id === sectionId);
      if (target) {
        applySectionTypeTemplate(draft, target, value);
      }
    });
  }

  async function deleteUploadedAsset(url: string) {
    if (!url || !url.startsWith('/uploads/')) {
      return;
    }

    await apiClient.deleteAdminMedia(url).catch(() => undefined);
  }

  async function saveContent() {
    const currentContent = contentRef.current || content;
    if (!currentContent) {
      return;
    }

    setBusy(true);
    setStatus(String(messages.savingContent || ''), 'success');

    try {
      const nextContent = applyAdminDrafts(currentContent, metaDraft, schemaDrafts, {
        meta: getAdminText(content, ['metaTitle']),
        taxonomies: getAdminText(content, ['taxonomiesTitle']),
        defaults: getAdminText(content, ['defaultsTitle']),
        sectionViews: getAdminText(content, ['sectionViewsTitle']),
        blockRenderers: getAdminText(content, ['blockRenderersTitle']),
        practiceScreens: getAdminText(content, ['practiceScreensTitle']),
        blockGroups: getAdminText(content, ['blockGroupsTitle']),
      });
      const saved = ensureAdminContentStructures(await apiClient.saveAdminContent(nextContent));
      const drafts = createSchemaDrafts(saved);
      contentRef.current = saved;
      setContent(saved);
      setMetaDraft(drafts.metaDraft);
      setSchemaDrafts(drafts.schemaDrafts);
      setSelectedSectionId((currentId) => ensureSelectedSectionId(saved, currentId));
      setStatus(String(messages.contentSaved || ''), 'success');
    } catch (nextError) {
      setStatus(nextError instanceof Error ? nextError.message : String(nextError), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSection() {
    let nextSelection = '';
    updateContent((draft) => {
      const section = createSectionTemplate(draft);
      draft.sections.push(section);
      nextSelection = section.id;
    });
    if (nextSelection) {
      setSelectedSectionId(nextSelection);
    }
    setStatus(String(messages.sectionAdded || ''), 'success');
  }

  async function handleDeleteSection(sectionId: string) {
    const section = content?.sections.find((item) => item.id === sectionId);
    for (const block of section?.blocks || []) {
      for (const material of block.materials || []) {
        await deleteUploadedAsset(material.url || '');
      }
    }

    const nextContent = content ? { ...content, sections: content.sections.filter((item) => item.id !== sectionId) } : null;
    updateContent((draft) => {
      draft.sections = draft.sections.filter((item) => item.id !== sectionId);
    });
    setSelectedSectionId((currentId) => ensureSelectedSectionId(nextContent, currentId));
    setStatus(String(messages.sectionDeleted || ''), 'success');
  }

  async function handleDeleteBlock(sectionId: string, blockId: string) {
    const section = content?.sections.find((item) => item.id === sectionId);
    const block = section?.blocks.find((item) => item.id === blockId);
    for (const material of block?.materials || []) {
      await deleteUploadedAsset(material.url || '');
    }

    updateContent((draft) => {
      const target = draft.sections.find((item) => item.id === sectionId);
      if (target) {
        target.blocks = target.blocks.filter((item) => item.id !== blockId);
      }
    });
    setStatus(String(messages.blockDeleted || ''), 'success');
  }

  async function handleDeleteMaterial(sectionId: string, blockId: string, materialId: string) {
    const section = content?.sections.find((item) => item.id === sectionId);
    const block = section?.blocks.find((item) => item.id === blockId);
    const material = block?.materials.find((item) => item.id === materialId);
    await deleteUploadedAsset(material?.url || '');

    updateContent((draft) => {
      const targetMaterialBlock = draft.sections.find((item) => item.id === sectionId)?.blocks.find((item) => item.id === blockId);
      if (targetMaterialBlock) {
        targetMaterialBlock.materials = targetMaterialBlock.materials.filter((item) => item.id !== materialId);
      }
    });
    setStatus(String(messages.materialDeleted || ''), 'success');
  }

  function handleMoveBlock(sectionId: string, blockId: string, direction: -1 | 1) {
    updateContent((draft) => {
      const targetSection = draft.sections.find((item) => item.id === sectionId);
      if (!targetSection) {
        return;
      }

      const currentIndex = targetSection.blocks.findIndex((item) => item.id === blockId);
      const nextIndex = currentIndex + direction;
      targetSection.blocks = moveItem(targetSection.blocks, currentIndex, nextIndex);
    });
    setStatus(String(messages.contentReordered || messages.contentSaved || ''), 'success');
  }

  function handleMoveMaterial(sectionId: string, blockId: string, materialId: string, direction: -1 | 1) {
    updateContent((draft) => {
      const targetBlock = draft.sections.find((item) => item.id === sectionId)?.blocks.find((item) => item.id === blockId);
      if (!targetBlock) {
        return;
      }

      const currentIndex = targetBlock.materials.findIndex((item) => item.id === materialId);
      const nextIndex = currentIndex + direction;
      targetBlock.materials = moveItem(targetBlock.materials, currentIndex, nextIndex);
    });
    setStatus(String(messages.contentReordered || messages.contentSaved || ''), 'success');
  }

  function handleUpdateReactionSelectorLabel(type: AnsweringMode, value: string) {
    updateMetaContent((draft) => {
      const targetConfig = ensureAnsweringQuestionTypeConfig(draft, type);
      targetConfig.selectorLabel = value;
    });
  }

  function handleAddReactionOption(type: AnsweringMode) {
    updateMetaContent((draft) => {
      const targetConfig = ensureAnsweringQuestionTypeConfig(draft, type);
      const currentOptions = Array.isArray(targetConfig.reactionOptions) ? [...targetConfig.reactionOptions] : [];
      currentOptions.push({
        id: `${type}-${Math.random().toString(36).slice(2, 10)}`,
        text: '',
        preferred: true,
      });
      targetConfig.reactionOptions = currentOptions;
    });
  }

  function handleUpdateReactionOption(type: AnsweringMode, optionId: string, value: string) {
    updateMetaContent((draft) => {
      const targetConfig = ensureAnsweringQuestionTypeConfig(draft, type);
      const currentOptions = Array.isArray(targetConfig.reactionOptions) ? targetConfig.reactionOptions : [];
      targetConfig.reactionOptions = currentOptions.map((item) => {
        const option = asRecord(item);
        if (String(option.id || '') !== optionId) {
          return option;
        }

        return {
          id: optionId,
          text: value,
          preferred: true,
        };
      });
    });
  }

  function handleMoveReactionOption(type: AnsweringMode, optionId: string, direction: -1 | 1) {
    updateMetaContent((draft) => {
      const targetConfig = ensureAnsweringQuestionTypeConfig(draft, type);
      const currentOptions = Array.isArray(targetConfig.reactionOptions) ? [...targetConfig.reactionOptions] : [];
      const currentIndex = currentOptions.findIndex((item) => String(asRecord(item).id || '') === optionId);
      const nextIndex = currentIndex + direction;
      targetConfig.reactionOptions = moveItem(currentOptions, currentIndex, nextIndex).map((item) => ({
        id: String(asRecord(item).id || ''),
        text: String(asRecord(item).text || ''),
        preferred: true,
      }));
    });
    setStatus(String(messages.contentReordered || messages.contentSaved || ''), 'success');
  }

  function handleDeleteReactionOption(type: AnsweringMode, optionId: string) {
    updateMetaContent((draft) => {
      const targetConfig = ensureAnsweringQuestionTypeConfig(draft, type);
      const currentOptions = Array.isArray(targetConfig.reactionOptions) ? targetConfig.reactionOptions : [];
      targetConfig.reactionOptions = currentOptions.filter((item) => String(asRecord(item).id || '') !== optionId);
    });
  }

  function handleDownloadBackup() {
    openExternal(apiClient.getAdminBackupExportUrl());
    setStatus(String(messages.backupDownloadStarted || ''), 'success');
  }

  async function handleRestoreBackup() {
    const file = await pickWebFileAsBase64('.zip,application/zip');
    if (!file) {
      return;
    }

    setBusy(true);
    try {
      const result = await apiClient.restoreAdminBackup(file.fileName, file.base64);
      await loadAdminContent();
      const restoredMessage = String(messages.backupRestored || '');
      const restartMessage = result.restartRequired ? String(messages.backupRestartRequired || '') : '';
      const combinedMessage = [restoredMessage, restartMessage].filter((item) => item).join(' ');
      setStatus(combinedMessage, 'success');
    } catch (nextError) {
      setStatus(nextError instanceof Error ? nextError.message : String(nextError), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function handleUploadMaterial(sectionId: string, blockId: string, materialId: string) {
    const file = await pickWebFileAsBase64();
    if (!file) {
      return;
    }

    try {
      let previousUrl = '';
      const uploaded = await apiClient.uploadAdminMedia(file.fileName, file.base64);
      updateContent((draft) => {
        const targetMaterial = draft.sections.find((item) => item.id === sectionId)?.blocks.find((item) => item.id === blockId)?.materials.find((item) => item.id === materialId);
        if (!targetMaterial) {
          return;
        }

        previousUrl = targetMaterial.url || '';
        targetMaterial.url = uploaded.url;
        targetMaterial.alt = targetMaterial.alt || file.fileName;
      });
      await deleteUploadedAsset(previousUrl);
      setStatus(String(messages.uploadedPattern || '').replace('{fileName}', file.fileName), 'success');
    } catch (nextError) {
      setStatus(nextError instanceof Error ? nextError.message : String(nextError), 'error');
    }
  }

  async function handleDeleteMaterialAsset(sectionId: string, blockId: string, materialId: string, url: string) {
    await deleteUploadedAsset(url);
    updateContent((draft) => {
      const targetMaterial = draft.sections.find((item) => item.id === sectionId)?.blocks.find((item) => item.id === blockId)?.materials.find((item) => item.id === materialId);
      if (targetMaterial) {
        targetMaterial.url = '';
      }
    });
    setStatus(String(messages.uploadedDeleted || ''), 'success');
  }

  if (loading) {
    return (
      <Screen
        appTitle={content?.meta.appTitle}
        brandTagline={getNestedString(asRecord(content?.meta?.ui), ['brandTagline'])}
        footerNote={getNestedString(asRecord(content?.meta?.ui), ['footerNote'])}
        title={getAdminText(content, ['loading'])}
      >
        <ActivityIndicator color={tokens.colors.accentContrast} />
      </Screen>
    );
  }

  return (
    <Screen
      appTitle={content?.meta.appTitle}
      brandTagline={getNestedString(asRecord(content?.meta?.ui), ['brandTagline'])}
      footerNote={getNestedString(asRecord(content?.meta?.ui), ['footerNote'])}
      title={getAdminText(content, ['title'])}
      subtitle={getAdminText(content, ['hint'])}
      backHref="/sections"
      backLabel={getAdminText(content, ['openLearnerApp'])}
    >
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={() => void saveContent()} disabled={busy}>
          <Text style={styles.primaryButtonText}>{getAdminText(content, ['saveContent'])}</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => void loadAdminContent()} disabled={busy}>
          <Text style={styles.secondaryButtonText}>{getAdminText(content, ['reloadFromDisk'])}</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={handleDownloadBackup} disabled={busy}>
          <Text style={styles.secondaryButtonText}>{String(actions.downloadBackup || '')}</Text>
        </Pressable>
        {Platform.OS === 'web' ? (
          <Pressable style={styles.secondaryButton} onPress={() => void handleRestoreBackup()} disabled={busy}>
            <Text style={styles.secondaryButtonText}>{String(actions.restoreBackup || '')}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondaryButton} onPress={() => router.replace('/admin')}>
          <Text style={styles.secondaryButtonText}>{getAdminText(content, ['refreshAdmin'])}</Text>
        </Pressable>
      </View>

      <Text style={styles.cardHint}>{getAdminText(content, ['backupHint'])}</Text>

      <StatusBanner text={error} tone="error" />
      <StatusBanner text={message} tone={messageTone} />

      <View style={styles.schemaGrid}>
        <SchemaCard title={getAdminText(content, ['schemaTitle'])} hint={getAdminText(content, ['schemaHint'])} value={schemaDrafts.taxonomies} onChange={(value) => setSchemaDrafts((current) => ({ ...current, taxonomies: value }))} />
        <SchemaCard title={getAdminText(content, ['defaultsTitle'])} hint={getAdminText(content, ['defaultsHint'])} value={schemaDrafts.defaults} onChange={(value) => setSchemaDrafts((current) => ({ ...current, defaults: value }))} />
        <SchemaCard title={getAdminText(content, ['sectionViewsTitle'])} hint={getAdminText(content, ['sectionViewsHint'])} value={schemaDrafts.sectionViews} onChange={(value) => setSchemaDrafts((current) => ({ ...current, sectionViews: value }))} />
        <SchemaCard title={getAdminText(content, ['blockRenderersTitle'])} hint={getAdminText(content, ['blockRenderersHint'])} value={schemaDrafts.blockRenderers} onChange={(value) => setSchemaDrafts((current) => ({ ...current, blockRenderers: value }))} />
        <SchemaCard title={getAdminText(content, ['practiceScreensTitle'])} hint={getAdminText(content, ['practiceScreensHint'])} value={schemaDrafts.practiceScreens} onChange={(value) => setSchemaDrafts((current) => ({ ...current, practiceScreens: value }))} />
        <SchemaCard title={getAdminText(content, ['blockGroupsTitle'])} hint={getAdminText(content, ['blockGroupsHint'])} value={schemaDrafts.blockGroups} onChange={(value) => setSchemaDrafts((current) => ({ ...current, blockGroups: value }))} />
      </View>

      <SchemaCard title={getAdminText(content, ['metaTitle'])} hint={getAdminText(content, ['metaHint'])} value={metaDraft} onChange={setMetaDraft} />

      <View style={[styles.layout, isWide ? styles.layoutWide : styles.layoutStack]}>
        <View style={[styles.sidebar, isWide ? styles.sidebarWide : null]}>
          <Pressable style={styles.primaryButton} onPress={() => void handleAddSection()}>
            <Text style={styles.primaryButtonText}>{String(actions.addSection || '')}</Text>
          </Pressable>
          {(content?.sections || []).map((section) => (
            <Pressable key={section.id} style={[styles.sidebarCard, selectedSectionId === section.id ? styles.sidebarCardActive : null]} onPress={() => setSelectedSectionId(section.id)}>
              <Text style={styles.sidebarTitle}>{section.title || section.route}</Text>
              <Text style={styles.sidebarRoute}>{section.route}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.editorColumn}>
          {!selectedSection ? (
            <View style={styles.editorCard}>
              <Text style={styles.cardTitle}>{getAdminText(content, ['emptySection'])}</Text>
            </View>
          ) : (
            <View style={styles.editorCard}>
              <Field label={String(fieldLabels.sectionRoute || '')}>
                <TextInput value={selectedSection.route} onChangeText={(value) => updateContent((draft) => {
                  const target = draft.sections.find((item) => item.id === selectedSection.id);
                  if (target) target.route = value;
                })} style={styles.input} />
              </Field>

              <Field label={String(fieldLabels.sectionType || '')}>
                <TextInput value={selectedSection.type} onChangeText={(value) => updateSectionType(selectedSection.id, value)} style={styles.input} />
                <ChoiceChips values={getTaxonomyValues(content, 'sectionTypes')} currentValue={selectedSection.type} labels={sectionTypeLabels} onPick={(value) => updateSectionType(selectedSection.id, value)} />
              </Field>

              <Field label={String(fieldLabels.eyebrow || '')}>
                <TextInput value={selectedSection.eyebrow || ''} onChangeText={(value) => updateContent((draft) => {
                  const target = draft.sections.find((item) => item.id === selectedSection.id);
                  if (target) target.eyebrow = value;
                })} style={styles.input} />
              </Field>

              <Field label={String(fieldLabels.sectionTitle || '')}>
                <TextInput value={selectedSection.title || ''} onChangeText={(value) => updateContent((draft) => {
                  const target = draft.sections.find((item) => item.id === selectedSection.id);
                  if (target) target.title = value;
                })} style={styles.input} />
              </Field>

              <Field label={String(fieldLabels.summary || '')}>
                <TextInput multiline value={selectedSection.summary || ''} onChangeText={(value) => updateContent((draft) => {
                  const target = draft.sections.find((item) => item.id === selectedSection.id);
                  if (target) target.summary = value;
                })} style={[styles.input, styles.textArea]} />
              </Field>

              <View style={styles.inlineActions}>
                <Pressable style={styles.secondaryButton} onPress={() => updateContent((draft) => {
                  const target = draft.sections.find((item) => item.id === selectedSection.id);
                  if (target) target.blocks.push(createBlockTemplate(draft));
                })}>
                  <Text style={styles.secondaryButtonText}>{String(actions.addBlock || '')}</Text>
                </Pressable>
                <Pressable style={styles.dangerButton} onPress={() => void handleDeleteSection(selectedSection.id)}>
                  <Text style={styles.dangerButtonText}>{String(actions.deleteSection || '')}</Text>
                </Pressable>
              </View>

              {selectedSection.blocks.map((block) => (
                <View key={block.id} style={styles.blockCard}>
                  <Field label={String(fieldLabels.blockTitle || '')}>
                    <TextInput value={block.title} onChangeText={(value) => updateContent((draft) => {
                      const targetBlock = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id);
                      if (targetBlock) targetBlock.title = value;
                    })} style={styles.input} />
                  </Field>

                  <Field label={String(fieldLabels.blockKind || '')}>
                    <TextInput value={block.kind} onChangeText={(value) => updateContent((draft) => {
                      const targetBlock = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id);
                      if (targetBlock) targetBlock.kind = value;
                    })} style={styles.input} />
                    <ChoiceChips values={getTaxonomyValues(content, 'blockKinds')} currentValue={block.kind} labels={blockKindLabels} onPick={(value) => updateContent((draft) => {
                      const targetBlock = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id);
                      if (targetBlock) targetBlock.kind = value;
                    })} />
                  </Field>

                  <Field label={String(fieldLabels.description || '')}>
                    <TextInput multiline value={block.description} onChangeText={(value) => updateContent((draft) => {
                      const targetBlock = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id);
                      if (targetBlock) targetBlock.description = value;
                    })} style={[styles.input, styles.textArea]} />
                  </Field>

                  <Field label={String(fieldLabels.route || '')}>
                    <TextInput value={block.route || ''} onChangeText={(value) => updateContent((draft) => {
                      const targetBlock = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id);
                      if (targetBlock) targetBlock.route = value;
                    })} style={styles.input} />
                  </Field>

                  <View style={styles.inlineActions}>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => handleMoveBlock(selectedSection.id, block.id, -1)}
                      disabled={selectedSection.blocks[0]?.id === block.id}
                    >
                      <Text style={styles.secondaryButtonText}>{String(actions.moveUp || '')}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => handleMoveBlock(selectedSection.id, block.id, 1)}
                      disabled={selectedSection.blocks[selectedSection.blocks.length - 1]?.id === block.id}
                    >
                      <Text style={styles.secondaryButtonText}>{String(actions.moveDown || '')}</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={() => updateContent((draft) => {
                      const targetBlock = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id);
                      if (targetBlock) targetBlock.materials.push(createMaterialTemplate(draft));
                    })}>
                      <Text style={styles.secondaryButtonText}>{String(actions.addMaterial || '')}</Text>
                    </Pressable>
                    <Pressable style={styles.dangerButton} onPress={() => void handleDeleteBlock(selectedSection.id, block.id)}>
                      <Text style={styles.dangerButtonText}>{String(actions.deleteBlock || '')}</Text>
                    </Pressable>
                  </View>

                  {isAnsweringPracticeBlock(block) ? (
                    <View style={styles.reactionEditorGroup}>
                      {ANSWERING_REACTION_TYPES.map((reactionType) => {
                        const reactionConfig = readAnsweringQuestionTypeConfig(content, reactionType);
                        const reactionOptions = readAnsweringReactionOptions(content, reactionType);
                        return (
                          <View key={`reaction-${block.id}-${reactionType}`} style={styles.materialCard}>
                            <Text style={styles.materialEditorTitle}>{String(reactionConfig.selectorLabel || reactionType)}</Text>
                            <Field label={String(fieldLabels.selectorLabel || '')}>
                              <TextInput
                                value={String(reactionConfig.selectorLabel || '')}
                                onChangeText={(value) => handleUpdateReactionSelectorLabel(reactionType, value)}
                                style={styles.input}
                              />
                            </Field>
                            <Field label={String(fieldLabels.reactionOptions || '')}>
                              <View style={styles.reactionOptionList}>
                                {reactionOptions.map((option, optionIndex) => {
                                  const optionId = String(option.id || '');
                                  return (
                                    <View key={optionId} style={styles.reactionOptionRow}>
                                      <TextInput
                                        value={String(option.text || '')}
                                        onChangeText={(value) => handleUpdateReactionOption(reactionType, optionId, value)}
                                        style={[styles.input, styles.reactionOptionInput]}
                                      />
                                      <View style={styles.inlineActions}>
                                        <Pressable
                                          style={styles.secondaryButton}
                                          onPress={() => handleMoveReactionOption(reactionType, optionId, -1)}
                                          disabled={optionIndex === 0}
                                        >
                                          <Text style={styles.secondaryButtonText}>{String(actions.moveUp || '')}</Text>
                                        </Pressable>
                                        <Pressable
                                          style={styles.secondaryButton}
                                          onPress={() => handleMoveReactionOption(reactionType, optionId, 1)}
                                          disabled={optionIndex === reactionOptions.length - 1}
                                        >
                                          <Text style={styles.secondaryButtonText}>{String(actions.moveDown || '')}</Text>
                                        </Pressable>
                                        <Pressable style={styles.dangerButton} onPress={() => handleDeleteReactionOption(reactionType, optionId)}>
                                          <Text style={styles.dangerButtonText}>{String(actions.deleteEntry || actions.deleteMaterial || '')}</Text>
                                        </Pressable>
                                      </View>
                                    </View>
                                  );
                                })}
                              </View>
                            </Field>
                            <Pressable style={styles.secondaryButton} onPress={() => handleAddReactionOption(reactionType)}>
                              <Text style={styles.secondaryButtonText}>{String(actions.addEntry || actions.addMaterial || '')}</Text>
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}

                  {block.materials.map((material) => {
                    const assetUrl = material.url ? resolveApiUrl(material.url) : '';
                    return (
                      <View key={material.id} style={styles.materialCard}>
                        <Field label={String(fieldLabels.materialTitle || '')}>
                          <TextInput value={material.title} onChangeText={(value) => updateContent((draft) => {
                            const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                            if (targetMaterial) targetMaterial.title = value;
                          })} style={styles.input} />
                        </Field>

                        <Field label={String(fieldLabels.materialType || '')}>
                          <TextInput value={material.type} onChangeText={(value) => updateContent((draft) => {
                            const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                            if (targetMaterial) targetMaterial.type = value;
                          })} style={styles.input} />
                          <ChoiceChips values={getTaxonomyValues(content, 'materialTypes')} currentValue={material.type} labels={materialTypeLabels} onPick={(value) => updateContent((draft) => {
                            const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                            if (targetMaterial) targetMaterial.type = value;
                          })} />
                        </Field>

                        <Field label={String(fieldLabels.body || '')}>
                          <TextInput multiline value={material.body} onChangeText={(value) => updateContent((draft) => {
                            const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                            if (targetMaterial) targetMaterial.body = value;
                          })} style={[styles.input, styles.textArea]} />
                        </Field>

                        <Field label={String(fieldLabels.url || '')}>
                          <TextInput value={material.url || ''} onChangeText={(value) => updateContent((draft) => {
                            const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                            if (targetMaterial) targetMaterial.url = value;
                          })} style={styles.input} />
                        </Field>

                        <Field label={String(fieldLabels.altText || '')}>
                          <TextInput value={material.alt || ''} onChangeText={(value) => updateContent((draft) => {
                            const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                            if (targetMaterial) targetMaterial.alt = value;
                          })} style={styles.input} />
                        </Field>

                        {isClarifyAudioMaterial(block, material) ? (
                          <>
                            <Field label={String(fieldLabels.statement || '')}>
                              <TextInput value={readMaterialMetaString(material, 'statement')} onChangeText={(value) => updateContent((draft) => {
                                const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                                if (!targetMaterial) return;
                                const meta = ensureMaterialMeta(targetMaterial);
                                meta.statement = value;
                              })} style={[styles.input, styles.textArea]} multiline />
                            </Field>

                            <Field label={String(fieldLabels.clarification || '')}>
                              <TextInput value={readMaterialMetaString(material, 'clarification')} onChangeText={(value) => updateContent((draft) => {
                                const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                                if (!targetMaterial) return;
                                const meta = ensureMaterialMeta(targetMaterial);
                                meta.clarification = value;
                              })} style={[styles.input, styles.textArea]} multiline />
                            </Field>

                            <Field label={String(fieldLabels.placeholder || '')}>
                              <TextInput value={readMaterialMetaString(material, 'placeholder')} onChangeText={(value) => updateContent((draft) => {
                                const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                                if (!targetMaterial) return;
                                const meta = ensureMaterialMeta(targetMaterial);
                                meta.placeholder = value;
                              })} style={[styles.input, styles.textArea]} multiline />
                            </Field>

                            <Field label={String(fieldLabels.acceptedAnswers || '')}>
                              <TextInput value={readMaterialMetaLines(material, 'acceptedAnswers')} onChangeText={(value) => updateContent((draft) => {
                                const targetMaterial = draft.sections.find((item) => item.id === selectedSection.id)?.blocks.find((item) => item.id === block.id)?.materials.find((item) => item.id === material.id);
                                if (!targetMaterial) return;
                                const meta = ensureMaterialMeta(targetMaterial);
                                meta.acceptedAnswers = value.split(/\r?\n/).map((item) => item.trim()).filter((item) => item.length > 0);
                              })} style={[styles.input, styles.textArea]} multiline />
                            </Field>
                          </>
                        ) : null}


                        {material.type === 'image' && material.url ? (
                          <Image source={{ uri: assetUrl }} style={styles.imagePreview} resizeMode="cover" />
                        ) : (
                          <View style={styles.previewBox}>
                            <Text style={styles.previewText}>{material.url || getNestedString(feedbackConfig, ['noFileUploaded'])}</Text>
                          </View>
                        )}

                        <View style={styles.inlineActions}>
                          <Pressable
                            style={styles.secondaryButton}
                            onPress={() => handleMoveMaterial(selectedSection.id, block.id, material.id, -1)}
                            disabled={block.materials[0]?.id === material.id}
                          >
                            <Text style={styles.secondaryButtonText}>{String(actions.moveUp || '')}</Text>
                          </Pressable>
                          <Pressable
                            style={styles.secondaryButton}
                            onPress={() => handleMoveMaterial(selectedSection.id, block.id, material.id, 1)}
                            disabled={block.materials[block.materials.length - 1]?.id === material.id}
                          >
                            <Text style={styles.secondaryButtonText}>{String(actions.moveDown || '')}</Text>
                          </Pressable>
                          {Platform.OS === 'web' ? (
                            <Pressable style={styles.secondaryButton} onPress={() => void handleUploadMaterial(selectedSection.id, block.id, material.id)}>
                              <Text style={styles.secondaryButtonText}>{String(actions.uploadMedia || '')}</Text>
                            </Pressable>
                          ) : null}
                          {material.url ? (
                            <Pressable style={styles.secondaryButton} onPress={() => openExternal(assetUrl)}>
                              <Text style={styles.secondaryButtonText}>{String(actions.openAsset || '')}</Text>
                            </Pressable>
                          ) : null}
                          <Pressable style={styles.secondaryButton} onPress={() => void handleDeleteMaterialAsset(selectedSection.id, block.id, material.id, material.url || '')}>
                            <Text style={styles.secondaryButtonText}>{String(actions.deleteUploadedFile || '')}</Text>
                          </Pressable>
                          <Pressable style={styles.dangerButton} onPress={() => void handleDeleteMaterial(selectedSection.id, block.id, material.id)}>
                            <Text style={styles.dangerButtonText}>{String(actions.deleteMaterial || '')}</Text>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  layout: {
    gap: tokens.spacing.md,
    alignItems: 'flex-start',
  },
  layoutWide: {
    flexDirection: 'row',
  },
  layoutStack: {
    flexDirection: 'column',
  },
  sidebar: {
    gap: tokens.spacing.sm,
    width: '100%',
  },
  sidebarWide: {
    width: 290,
  },
  sidebarCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  sidebarCardActive: {
    backgroundColor: tokens.colors.surface,
    borderColor: tokens.colors.accent,
  },
  sidebarTitle: {
    color: tokens.colors.ink,
    fontWeight: '800',
  },
  sidebarRoute: {
    marginTop: 4,
    color: tokens.colors.inkSoft,
    fontSize: 12,
  },
  editorColumn: {
    flex: 1,
    width: '100%',
    gap: tokens.spacing.md,
  },
  editorCard: {
    width: '100%',
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  blockCard: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.md,
  },
  materialCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  reactionEditorGroup: {
    gap: tokens.spacing.sm,
  },
  materialEditorTitle: {
    color: tokens.colors.ink,
    fontWeight: '800',
    fontSize: 15,
  },
  reactionOptionList: {
    gap: tokens.spacing.sm,
  },
  reactionOptionRow: {
    gap: tokens.spacing.xs,
  },
  reactionOptionInput: {
    minHeight: 48,
  },
  schemaGrid: {
    gap: tokens.spacing.md,
  },
  schemaCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    color: tokens.colors.ink,
    fontWeight: '700',
    fontSize: 13,
  },
  input: {
    width: '100%',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    backgroundColor: tokens.colors.surfaceStrong,
    color: tokens.colors.ink,
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  jsonInput: {
    minHeight: 220,
    textAlignVertical: 'top',
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.xs,
  },
  choiceChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  choiceChipActive: {
    borderColor: tokens.colors.accent,
    backgroundColor: '#ffe5ca',
  },
  choiceText: {
    color: tokens.colors.inkSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  choiceTextActive: {
    color: tokens.colors.accentDeep,
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  primaryButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: tokens.colors.accentContrast,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: tokens.colors.ink,
    fontWeight: '700',
  },
  dangerButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    backgroundColor: '#fff0ec',
    borderWidth: 1,
    borderColor: 'rgba(141,38,0,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerButtonText: {
    color: tokens.colors.danger,
    fontWeight: '700',
  },
  statusCard: {
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.md,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: 'rgba(232,255,240,0.86)',
    borderColor: 'rgba(32,101,58,0.2)',
  },
  statusError: {
    backgroundColor: 'rgba(255,240,236,0.92)',
    borderColor: 'rgba(141,38,0,0.2)',
  },
  statusText: {
    lineHeight: 22,
  },
  statusTextSuccess: {
    color: tokens.colors.success,
  },
  statusTextError: {
    color: tokens.colors.danger,
  },
  cardTitle: {
    color: tokens.colors.ink,
    fontWeight: '900',
    fontSize: 18,
  },
  cardHint: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
  },
  previewBox: {
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    backgroundColor: tokens.colors.surfaceStrong,
  },
  previewText: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
  },
  imagePreview: {
    width: '100%',
    height: 220,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
});





