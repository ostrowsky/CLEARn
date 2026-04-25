import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { AppContent, ContentBlock, ContentMaterial, ContentSection } from '@softskills/domain';
import { Screen } from '../../src/components/Screen';
import { AskAfterComposer } from '../../src/components/practice/AskAfterComposer';
import { ClarifyPracticeInlineList } from '../../src/components/practice/ClarifyPracticeInlineList';
import { QuestionFormationPractice } from '../../src/components/practice/QuestionFormationPractice';
import { useContent } from '../../src/hooks/useContent';
import { findSectionById, findSectionByRoute, getParentSection } from '../../src/lib/contentNavigation';
import {
  fillRuntimeTemplate,
  findPracticeScreenForSection,
  getBlockRenderer,
  getNestedString,
  getSectionViewConfig,
  getUiConfig,
} from '../../src/lib/contentMeta';
import { resolveApiUrl } from '../../src/lib/api';
import { tokens } from '../../src/theme/tokens';

const directVideoPattern = /\.(mp4|webm|ogv|mov|m4v)(?:[?#].*)?$/i;
const directAudioPattern = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)(?:[?#].*)?$/i;
const directImagePattern = /\.(png|jpg|jpeg|gif|webp|svg)(?:[?#].*)?$/i;
const youTubeWatchPattern = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
const youTubeEmbedPattern = /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i;
const vimeoPattern = /vimeo\.com\/(?:video\/)?(\d+)/i;

function getPracticeHref(content: AppContent | null | undefined, section: ContentSection, block: ContentBlock) {
  const renderer = getBlockRenderer(content, block.kind);
  const match = findPracticeScreenForSection(content, section, renderer);
  if (!match) {
    return undefined;
  }

  const templateValues = {
    ...match.params,
    sectionId: section.id,
    sectionRoute: section.route,
    sectionType: section.type,
    blockId: block.id,
    blockKind: block.kind,
  };

  const templateHref = getNestedString(match.config, ['targetHrefTemplate']);
  if (templateHref) {
    return fillRuntimeTemplate(templateHref, templateValues);
  }

  const directHref = getNestedString(match.config, ['targetHref']);
  return directHref ? fillRuntimeTemplate(directHref, templateValues) : undefined;
}

function getMaterialUrl(material: ContentMaterial) {
  return material.url ? resolveApiUrl(material.url) : '';
}

function isDirectAsset(url: string, pattern: RegExp) {
  return Boolean(url) && (url.startsWith('data:') || url.startsWith('blob:') || pattern.test(url));
}

function getEmbeddedVideoUrl(url: string) {
  if (!url) {
    return '';
  }

  const embedMatch = url.match(youTubeEmbedPattern);
  if (embedMatch) {
    return `https://www.youtube.com/embed/${embedMatch[1]}`;
  }

  const youTubeMatch = url.match(youTubeWatchPattern);
  if (youTubeMatch) {
    return `https://www.youtube.com/embed/${youTubeMatch[1]}`;
  }

  const vimeoMatch = url.match(vimeoPattern);
  if (vimeoMatch) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }

  return '';
}

function openExternalUrl(url: string) {
  if (!url) {
    return;
  }

  void Linking.openURL(url);
}

function WebVideoPlayer({ url }: { url: string }) {
  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.webMediaShell}>
      <video controls playsInline preload="metadata" src={url} style={webVideoStyle} />
    </View>
  );
}

function WebAudioPlayer({ url }: { url: string }) {
  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.webAudioShell}>
      <audio controls preload="metadata" src={url} style={webAudioStyle} />
    </View>
  );
}

function WebVideoEmbed({ url }: { url: string }) {
  if (Platform.OS !== 'web' || !url) {
    return null;
  }

  return (
    <View style={styles.webMediaShell}>
      <iframe
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        src={url}
        style={webFrameStyle}
        title="embedded-video"
      />
    </View>
  );
}

function MaterialOpenButton({ url, label }: { url: string; label: string }) {
  if (!url) {
    return null;
  }

  return (
    <Pressable style={styles.mediaButton} onPress={() => openExternalUrl(url)}>
      <Text style={styles.mediaButtonText}>{label}</Text>
    </Pressable>
  );
}

function renderMaterial(material: ContentMaterial, options: { emptyMediaText: string; inlineMediaUnavailable: string; openMediaLabel: string }) {
  const placeholderCopy = material.body || options.emptyMediaText;
  const mediaUrl = getMaterialUrl(material);
  const embeddedVideoUrl = material.type === 'video' ? getEmbeddedVideoUrl(mediaUrl) : '';
  const isDirectVideo = material.type === 'video' && isDirectAsset(mediaUrl, directVideoPattern);
  const isDirectAudio = material.type === 'audio' && isDirectAsset(mediaUrl, directAudioPattern);
  const isDirectImage = material.type === 'image' && isDirectAsset(mediaUrl, directImagePattern);

  if (material.type === 'text') {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <Text style={styles.materialBody}>{material.body}</Text>
      </View>
    );
  }

  if (isDirectImage) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <Image source={{ uri: mediaUrl }} style={styles.imagePreview} resizeMode="cover" />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} />
      </View>
    );
  }

  if (isDirectVideo) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <WebVideoPlayer url={mediaUrl} />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        {Platform.OS !== 'web' ? <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} /> : null}
      </View>
    );
  }

  if (embeddedVideoUrl) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <WebVideoEmbed url={embeddedVideoUrl} />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} />
      </View>
    );
  }

  if (isDirectAudio) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <WebAudioPlayer url={mediaUrl} />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} />
      </View>
    );
  }

  return (
    <View key={material.id} style={[styles.materialCard, styles.placeholderCard]}>
      <Text style={styles.materialLabel}>{material.title}</Text>
      <Text style={styles.materialBody}>{placeholderCopy}</Text>
      {mediaUrl ? <Text style={styles.inlineNotice}>{options.inlineMediaUnavailable}</Text> : null}
      <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} />
    </View>
  );
}

function BlockAccordion({
  block,
  open,
  onToggle,
  onOpenPractice,
  practiceButtonLabel,
  emptyMediaText,
  inlineMediaUnavailable,
  openMediaLabel,
}: {
  block: ContentBlock;
  open: boolean;
  onToggle: () => void;
  onOpenPractice?: () => void;
  practiceButtonLabel: string;
  emptyMediaText: string;
  inlineMediaUnavailable: string;
  openMediaLabel: string;
}) {
  return (
    <View style={[styles.blockCard, open ? styles.blockCardOpen : null]}>
      <Pressable style={styles.blockToggle} onPress={onToggle}>
        <View style={styles.blockHeaderCopy}>
          <Text style={styles.blockTitle}>{block.title}</Text>
          <Text style={styles.blockDescription}>{block.description}</Text>
        </View>
        <View style={[styles.toggleBadge, open ? styles.toggleBadgeOpen : null]}>
          <Text style={styles.toggleGlyph}>{open ? '-' : '+'}</Text>
        </View>
      </Pressable>

      {open ? (
        <View style={styles.blockBody}>
          {(block.materials ?? []).map((material) => renderMaterial(material, { emptyMediaText, inlineMediaUnavailable, openMediaLabel }))}
          {onOpenPractice ? (
            <Pressable style={styles.practiceButton} onPress={onOpenPractice}>
              <Text style={styles.practiceButtonText}>{practiceButtonLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function BlockPanel({
  block,
  onOpenPractice,
  practiceButtonLabel,
  emptyMediaText,
  inlineMediaUnavailable,
  openMediaLabel,
}: {
  block: ContentBlock;
  onOpenPractice?: () => void;
  practiceButtonLabel: string;
  emptyMediaText: string;
  inlineMediaUnavailable: string;
  openMediaLabel: string;
}) {
  return (
    <View style={styles.blockCard}>
      <Text style={styles.blockTitle}>{block.title}</Text>
      <Text style={styles.blockDescription}>{block.description}</Text>
      <View style={styles.blockBody}>
        {(block.materials ?? []).map((material) => renderMaterial(material, { emptyMediaText, inlineMediaUnavailable, openMediaLabel }))}
        {onOpenPractice ? (
          <Pressable style={styles.practiceButton} onPress={onOpenPractice}>
            <Text style={styles.practiceButtonText}>{practiceButtonLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function SectionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { content, loading, error } = useContent();
  const { width } = useWindowDimensions();
  const section = findSectionById(content, id);
  const parentSection = getParentSection(content, section);
  const [openBlocks, setOpenBlocks] = useState<Record<string, boolean>>({});
  const isWide = width >= 920;
  const sectionView = getSectionViewConfig(content, section?.type);
  const collapsibleSection = Boolean(section && sectionView.collapsible);
  const ui = getUiConfig(content);
  const loadingTitle = getNestedString(ui, ['feedback', 'loadingSectionTitle']);
  const loadingSubtitle = getNestedString(ui, ['feedback', 'loadingSectionSubtitle']);
  const missingTitle = getNestedString(ui, ['feedback', 'sectionNotFoundTitle']);
  const missingSubtitle = getNestedString(ui, ['feedback', 'sectionNotFoundSubtitle']);
  const loadErrorTitle = getNestedString(ui, ['feedback', 'unableToLoadContentTitle']);
  const noFileUploaded = getNestedString(ui, ['feedback', 'noFileUploaded']);
  const inlineMediaUnavailable = getNestedString(ui, ['feedback', 'inlineMediaUnavailable']);
  const openLivePractice = getNestedString(ui, ['buttons', 'openLivePractice']);
  const openMedia = getNestedString(ui, ['buttons', 'openMedia']);
  const backToHome = getNestedString(ui, ['navigation', 'backToHome']);

  useEffect(() => {
    if (!section) {
      return;
    }

    const nextState: Record<string, boolean> = {};
    for (const block of section.blocks) {
      nextState[block.id] = false;
    }
    setOpenBlocks(nextState);
  }, [section?.id]);

  if (!section) {
    return (
      <Screen
        appTitle={content?.meta.appTitle}
        brandTagline={getNestedString(ui, ['brandTagline'])}
        footerNote={getNestedString(ui, ['footerNote'])}
        title={loading ? loadingTitle : missingTitle}
        subtitle={loading ? loadingSubtitle : missingSubtitle}
        backHref="/sections"
        backLabel={backToHome}
      >
        {loading ? <ActivityIndicator color={tokens.colors.accentContrast} /> : null}
        {error ? (
          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackTitle}>{loadErrorTitle}</Text>
            <Text style={styles.feedbackText}>{error}</Text>
          </View>
        ) : null}
      </Screen>
    );
  }

  const routeBlocks = section.blocks.filter((block) => getBlockRenderer(content, block.kind) === 'nav-card' && block.route);
  const contentBlocks = section.blocks.filter((block) => !(getBlockRenderer(content, block.kind) === 'nav-card' && block.route));
  const showInlineAskAfterComposer = section.type === 'practice-ask-after' || section.type === 'exercise-ask-after';
  const askAfterPracticeBlock = showInlineAskAfterComposer
    ? (section.blocks.find((block) => getBlockRenderer(content, block.kind) === 'practice-ask-after') || null)
    : null;
  const primaryRouteCount = sectionView.primaryCardStrategy === 'first' ? 1 : 0;
  const featuredBlockCount = isWide ? sectionView.featuredBlockCount : 0;

  return (
    <Screen
      appTitle={content?.meta.appTitle}
      brandTagline={getNestedString(ui, ['brandTagline'])}
      footerNote={getNestedString(ui, ['footerNote'])}
      eyebrow={section.eyebrow}
      title={section.title}
      subtitle={section.summary}
      backHref={parentSection ? `/section/${parentSection.id}` : '/sections'}
      backLabel={parentSection ? parentSection.title : backToHome}
    >
      {loading && !content ? <ActivityIndicator color={tokens.colors.accentContrast} /> : null}
      {error ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackTitle}>{loadErrorTitle}</Text>
          <Text style={styles.feedbackText}>{error}</Text>
        </View>
      ) : null}

      {routeBlocks.length ? (
        <View style={styles.routeGrid}>
          {routeBlocks.map((block, index) => {
            const targetSection = findSectionByRoute(content, block.route);
            if (!targetSection) {
              return null;
            }

            return (
              <Pressable
                key={block.id}
                style={[styles.routeCard, index < primaryRouteCount ? styles.routeCardPrimary : null]}
                onPress={() => router.push(`/section/${targetSection.id}`)}
              >
                <Text style={styles.routeCardTitle}>{block.title}</Text>
                <Text style={styles.routeCardText}>{block.description}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showInlineAskAfterComposer && askAfterPracticeBlock ? (
        <AskAfterComposer content={content} section={section} practiceBlock={askAfterPracticeBlock} />
      ) : contentBlocks.length ? (
        <View style={styles.blockGrid}>
          {contentBlocks.map((block, index) => {
            const practiceHref = getPracticeHref(content, section, block);
            const renderer = getBlockRenderer(content, block.kind);
            const isHalfWidthCard = renderer !== 'practice-clarify' && renderer !== 'practice-without-context' && featuredBlockCount > 0 && index < featuredBlockCount;

            return (
              <View
                key={block.id}
                style={[
                  styles.blockSlot,
                  isHalfWidthCard ? styles.blockSlotHalf : styles.blockSlotFull,
                ]}
              >
                {renderer === 'practice-clarify' ? (
                  <ClarifyPracticeInlineList content={content} section={section} block={block} />
                ) : renderer === 'practice-without-context' ? (
                  <QuestionFormationPractice content={content} section={section} block={block} />
                ) : collapsibleSection ? (
                  <BlockAccordion
                    block={block}
                    open={Boolean(openBlocks[block.id])}
                    onToggle={() => setOpenBlocks((current) => ({
                      ...current,
                      [block.id]: !current[block.id],
                    }))}
                    onOpenPractice={practiceHref ? () => router.push(practiceHref) : undefined}
                    practiceButtonLabel={openLivePractice}
                    emptyMediaText={noFileUploaded}
                    inlineMediaUnavailable={inlineMediaUnavailable}
                    openMediaLabel={openMedia}
                  />
                ) : (
                  <BlockPanel
                    block={block}
                    onOpenPractice={practiceHref ? () => router.push(practiceHref) : undefined}
                    practiceButtonLabel={openLivePractice}
                    emptyMediaText={noFileUploaded}
                    inlineMediaUnavailable={inlineMediaUnavailable}
                    openMediaLabel={openMedia}
                  />
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

const webFrameStyle = {
  width: '100%',
  height: 280,
  border: 0,
  borderRadius: 18,
  backgroundColor: '#000',
};

const webVideoStyle = {
  width: '100%',
  height: 280,
  borderRadius: 18,
  backgroundColor: '#000',
};

const webAudioStyle = {
  width: '100%',
};

const styles = StyleSheet.create({
  routeGrid: {
    gap: tokens.spacing.md,
  },
  routeCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    minHeight: 110,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  routeCardPrimary: {
    backgroundColor: tokens.colors.surface,
  },
  routeCardTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  routeCardText: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  blockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.md,
  },
  blockSlot: {
    minWidth: 0,
  },
  blockSlotHalf: {
    width: '48.8%',
  },
  blockSlotFull: {
    width: '100%',
  },
  blockCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  blockCardOpen: {
    backgroundColor: tokens.colors.surfaceMuted,
  },
  blockToggle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacing.md,
  },
  blockHeaderCopy: {
    flex: 1,
  },
  blockTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  blockDescription: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  toggleBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.colors.surface,
  },
  toggleBadgeOpen: {
    backgroundColor: tokens.colors.accentSoft,
  },
  toggleGlyph: {
    color: tokens.colors.accentDeep,
    fontSize: 18,
    fontWeight: '900',
  },
  blockBody: {
    marginTop: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  materialCard: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.md,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    gap: tokens.spacing.sm,
  },
  placeholderCard: {
    backgroundColor: tokens.colors.surfaceMuted,
  },
  materialLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  materialBody: {
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
  inlineNotice: {
    color: tokens.colors.inkSoft,
    lineHeight: 20,
    fontSize: 13,
  },
  imagePreview: {
    width: '100%',
    height: 240,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surfaceMuted,
  },
  webMediaShell: {
    width: '100%',
    minHeight: 280,
    borderRadius: tokens.radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  webAudioShell: {
    width: '100%',
  },
  mediaButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    justifyContent: 'center',
  },
  mediaButtonText: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  practiceButton: {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radius.md,
    paddingVertical: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: 'center',
  },
  practiceButtonText: {
    color: tokens.colors.accentDeep,
    fontWeight: '800',
  },
  feedbackCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  feedbackTitle: {
    color: tokens.colors.danger,
    fontWeight: '800',
    fontSize: 16,
  },
  feedbackText: {
    marginTop: tokens.spacing.xs,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
  },
});

