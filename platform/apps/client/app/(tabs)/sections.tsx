import { type Href, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BrandLogo } from '../../src/components/BrandLogo';
import { useContent } from '../../src/hooks/useContent';
import { findSectionByRoute } from '../../src/lib/contentNavigation';
import { getNestedRecord, getNestedString, getUiConfig } from '../../src/lib/contentMeta';
import { tokens } from '../../src/theme/tokens';

type HomeMenuItem = {
  label: string;
  route: string;
};

type HomeModuleCard = HomeMenuItem & {
  description: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]) {
  const next = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  return next.length ? next : fallback;
}

function asMenuItems(value: unknown, fallback: HomeMenuItem[]) {
  const next = Array.isArray(value)
    ? value.map((item) => {
      const record = asRecord(item);
      return {
        label: asString(record.label),
        route: asString(record.route, '/'),
      };
    }).filter((item) => item.label)
    : [];
  return next.length ? next : fallback;
}

function asModuleCards(value: unknown, fallback: HomeModuleCard[]) {
  const next = Array.isArray(value)
    ? value.map((item) => {
      const record = asRecord(item);
      return {
        label: asString(record.label),
        route: asString(record.route, '/'),
        description: asString(record.description),
      };
    }).filter((item) => item.label)
    : [];
  return next.length ? next : fallback;
}

const fallbackModuleWords = ['ASK', 'ANSWER', 'CHAT'];
const fallbackSkillMenu: HomeMenuItem[] = [
  { label: 'Interrupt and ask', route: '/asking/interrupt' },
  { label: 'Ask after the talk', route: '/asking/after-talk' },
  { label: 'Question formation drill', route: '/asking/without-context' },
  { label: '10-question mixed session', route: '/answering/mixed' },
];
const fallbackAboutMenu: HomeMenuItem[] = [
  { label: 'How it works', route: '/' },
  { label: 'For teams', route: '/' },
  { label: 'Contact', route: '/' },
];
const fallbackHomeCards: HomeModuleCard[] = [
  {
    label: 'Practice asking questions',
    route: '/asking',
    description: 'Interrupt politely, ask after the talk, and clarify missing details in dialogues built around your engineering context.',
  },
  {
    label: 'Practice answering questions',
    route: '/answering',
    description: 'Handle good, difficult, unnecessary and irrelevant questions in short dialogues with reaction coaching.',
  },
  {
    label: 'Try the AI learning chat',
    route: '/learning-chat',
    description: 'Hold a short text conversation with the coach and get focused feedback after every turn.',
  },
];

function useHomeMenuHoverStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const styleId = 'clearn-home-menu-hover';
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      [aria-label^="home-module-"],
      [aria-label^="home-skill-"],
      [aria-label^="home-about-"],
      [aria-label^="home-card-"],
      [aria-label="home-menu-button"] {
        cursor: pointer;
      }

      [aria-label^="home-module-"]:hover [data-clearn-role="word"] {
        color: ${tokens.colors.ink} !important;
      }

      [aria-label^="home-module-"]:hover [data-clearn-role="index"] {
        color: ${tokens.colors.accent} !important;
      }

      [aria-label^="home-skill-"]:hover [dir="auto"],
      [aria-label^="home-about-"]:hover [dir="auto"] {
        color: ${tokens.colors.accent} !important;
      }

      [aria-label^="home-card-"]:hover [data-clearn-role="card-title"],
      [aria-label^="home-card-"]:hover [data-clearn-role="card-index"] {
        color: ${tokens.colors.accent} !important;
      }

      [aria-label^="home-card-"]:hover [data-clearn-role="card-arrow"] {
        background-color: ${tokens.colors.accent} !important;
        border-color: ${tokens.colors.accent} !important;
      }

      [aria-label="home-menu-button"]:hover {
        border-color: ${tokens.colors.accent} !important;
      }

      [aria-label="home-menu-button"]:hover [data-clearn-role="menu-trigger-line"] {
        background-color: ${tokens.colors.accent} !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);
}

export default function SectionsScreen() {
  const router = useRouter();
  const { content, loading, error } = useContent();
  const [hoveredItem, setHoveredItem] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  useHomeMenuHoverStyles();
  const { width } = useWindowDimensions();
  const ui = getUiConfig(content);
  const homeMenu = getNestedRecord(ui, ['homeMenu']);
  const moduleWords = asStringArray(homeMenu.moduleWords, fallbackModuleWords);
  const skillMenu = asMenuItems(homeMenu.skills, fallbackSkillMenu);
  const aboutMenu = asMenuItems(homeMenu.about, fallbackAboutMenu);
  const homeCards = asModuleCards(homeMenu.moduleCards, fallbackHomeCards);
  const skillsHeading = asString(homeMenu.skillsHeading, 'SKILLS');
  const aboutHeading = asString(homeMenu.aboutHeading, 'ABOUT');
  const compact = width < 760;

  const homeCopy = useMemo(() => ({
    lead: asString(
      homeMenu.leadText,
      'A practice studio for engineers who need to interrupt, clarify, and answer in English meetings without freezing.',
    ),
    sectionTitle: asString(homeMenu.pathsTitle, 'Pick a path. Drill the gap.'),
    startPracticing: asString(homeMenu.startPracticingLabel, 'start practicing'),
    menuTrigger: asString(homeMenu.menuTriggerLabel, 'ASK ANSWER chat'),
    primaryCta: asString(homeMenu.primaryCtaLabel, 'Start with asking'),
    secondaryCta: asString(homeMenu.secondaryCtaLabel, 'Practice answering'),
  }), [homeMenu.leadText, homeMenu.menuTriggerLabel, homeMenu.pathsTitle, homeMenu.primaryCtaLabel, homeMenu.secondaryCtaLabel, homeMenu.startPracticingLabel]);

  function openRoute(route: string) {
    const targetSection = findSectionByRoute(content, route);
    if (targetSection) {
      router.push(targetSection.route as Href);
      return;
    }
    router.push(route as Href);
  }

  function renderArrow(size: 'small' | 'large' = 'large') {
    return (
      <View data-clearn-role="card-arrow" style={[styles.arrowCircle, size === 'small' ? styles.arrowCircleSmall : null]}>
        <Text style={styles.arrowGlyph}>{'->'}</Text>
      </View>
    );
  }

  function renderTopBar(showActions = true) {
    return (
      <View style={styles.topBar}>
        <BrandLogo compact />
        {showActions ? (
          <View style={styles.headerCta}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="home-menu-button"
            accessibilityHint={homeCopy.menuTrigger}
            onPress={() => setMenuOpen((current) => !current)}
            onHoverIn={() => setHoveredItem('menu')}
            onHoverOut={() => setHoveredItem('')}
            style={[styles.headerLink, hoveredItem === 'menu' ? styles.headerLinkHovered : null]}
          >
            <Text data-clearn-role="menu-trigger-line" style={[styles.headerLinkLine, hoveredItem === 'menu' ? styles.headerLinkLineHovered : null]} />
            <Text data-clearn-role="menu-trigger-line" style={[styles.headerLinkLine, hoveredItem === 'menu' ? styles.headerLinkLineHovered : null]} />
            <Text data-clearn-role="menu-trigger-line" style={[styles.headerLinkLine, hoveredItem === 'menu' ? styles.headerLinkLineHovered : null]} />
          </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  function renderMenuOverlay() {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View pointerEvents="none" style={styles.orb} />
        <ScrollView contentContainerStyle={[styles.scrollContent, compact ? styles.scrollContentCompact : null]}>
          <View style={styles.shell}>
            {renderTopBar()}

            <View style={[styles.menuGrid, compact ? styles.menuGridCompact : null]}>
              <View style={styles.bigWordsColumn}>
                {moduleWords.map((word, index) => (
                  <Pressable
                    key={`${word}-${index}`}
                    accessibilityRole="link"
                    accessibilityLabel={`home-module-${word}`}
                    style={styles.bigWordRow}
                    onHoverIn={() => setHoveredItem(`module-${index}`)}
                    onHoverOut={() => setHoveredItem('')}
                    onPress={() => openRoute(index === 0 ? '/asking' : index === 1 ? '/answering' : '/learning-chat')}
                  >
                    <Text data-clearn-role="index" style={[styles.bigWordNumber, hoveredItem === `module-${index}` ? styles.bigWordNumberHovered : null]}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <Text data-clearn-role="word" style={[styles.bigWord, compact ? styles.bigWordCompact : null, hoveredItem === `module-${index}` ? styles.bigWordHovered : null]}>
                      {word}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.sideMenu}>
                <View style={styles.sideGroup}>
                  <Text style={styles.sideHeading}>{skillsHeading}</Text>
                  {skillMenu.map((item, index) => (
                    <Pressable
                      key={`${item.label}-${item.route}`}
                      accessibilityRole="link"
                      accessibilityLabel={`home-skill-${item.label}`}
                      style={styles.sideLink}
                      onHoverIn={() => setHoveredItem(`skill-${index}`)}
                      onHoverOut={() => setHoveredItem('')}
                      onPress={() => openRoute(item.route)}
                    >
                      <Text style={[styles.sideLinkText, hoveredItem === `skill-${index}` ? styles.sideLinkTextHovered : null]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.sideGroup}>
                  <Text style={styles.sideHeading}>{aboutHeading}</Text>
                  {aboutMenu.map((item, index) => (
                    <Pressable
                      key={`${item.label}-${item.route}`}
                      accessibilityRole="link"
                      accessibilityLabel={`home-about-${item.label}`}
                      style={styles.sideLink}
                      onHoverIn={() => setHoveredItem(`about-${index}`)}
                      onHoverOut={() => setHoveredItem('')}
                      onPress={() => openRoute(item.route)}
                    >
                      <Text style={[styles.sideLinkText, hoveredItem === `about-${index}` ? styles.sideLinkTextHovered : null]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            {loading && !content ? <ActivityIndicator color={tokens.colors.accent} /> : null}
            {error ? (
              <View style={styles.feedbackCard}>
                <Text style={styles.feedbackText}>{getNestedString(ui, ['feedback', 'unableToLoadContentTitle']) || error}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
        <Text style={styles.watermark}>{getNestedString(ui, ['watermarkText'])}</Text>
      </SafeAreaView>
    );
  }

  if (menuOpen) {
    return renderMenuOverlay();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View pointerEvents="none" style={styles.orb} />
      <ScrollView contentContainerStyle={[styles.homeScrollContent, compact ? styles.homeScrollContentCompact : null]}>
        <View style={[styles.homeShell, compact ? styles.homeShellCompact : null]}>
          {renderTopBar()}

          <View style={[styles.homeHero, compact ? styles.homeHeroCompact : null]}>
            {moduleWords.slice(0, 3).map((word, index) => {
              const route = index === 0 ? '/asking' : index === 1 ? '/answering' : '/learning-chat';
              const label = index === 2 ? word.toLowerCase() : word;
              const isHovered = hoveredItem === `hero-${index}`;
              return (
                <Pressable
                  key={`${word}-${index}`}
                  accessibilityRole="link"
                  accessibilityLabel={`home-hero-${word}`}
                  onHoverIn={() => setHoveredItem(`hero-${index}`)}
                  onHoverOut={() => setHoveredItem('')}
                  onPress={() => openRoute(route)}
                >
                  <Text
                    accessibilityRole={index === 0 ? 'header' : undefined}
                    style={[
                      styles.homeHeroWord,
                      index === 2 ? styles.homeHeroAccent : null,
                      compact ? styles.homeHeroWordCompact : null,
                      isHovered ? styles.homeHeroWordHovered : null,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {compact ? (
              <>
                <Text style={[styles.homeLead, styles.homeLeadCompact]}>{homeCopy.lead}</Text>
                <View style={styles.homeCtaRow}>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => openRoute('/asking')}
                    onHoverIn={() => setHoveredItem('primary-cta')}
                    onHoverOut={() => setHoveredItem('')}
                    style={[styles.btn, styles.btnAccent, styles.btnLarge, hoveredItem === 'primary-cta' ? styles.btnAccentHovered : null]}
                  >
                    <Text style={styles.btnAccentText}>{homeCopy.primaryCta}</Text>
                    <Text style={styles.btnAccentText}>{'->'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => openRoute('/answering')}
                    onHoverIn={() => setHoveredItem('secondary-cta')}
                    onHoverOut={() => setHoveredItem('')}
                    style={[styles.btn, styles.btnGhost, styles.btnLarge, hoveredItem === 'secondary-cta' ? styles.btnGhostHovered : null]}
                  >
                    <Text style={[styles.btnGhostText, hoveredItem === 'secondary-cta' ? styles.btnGhostTextHovered : null]}>{homeCopy.secondaryCta}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.homeLead}>{homeCopy.lead}</Text>
                <View style={styles.homeCtaRow}>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => openRoute('/asking')}
                    onHoverIn={() => setHoveredItem('primary-cta')}
                    onHoverOut={() => setHoveredItem('')}
                    style={[styles.btn, styles.btnAccent, styles.btnLarge, hoveredItem === 'primary-cta' ? styles.btnAccentHovered : null]}
                  >
                    <Text style={styles.btnAccentText}>{homeCopy.primaryCta}</Text>
                    <Text style={styles.btnAccentText}>{'->'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => openRoute('/answering')}
                    onHoverIn={() => setHoveredItem('secondary-cta')}
                    onHoverOut={() => setHoveredItem('')}
                    style={[styles.btn, styles.btnGhost, styles.btnLarge, hoveredItem === 'secondary-cta' ? styles.btnGhostHovered : null]}
                  >
                    <Text style={[styles.btnGhostText, hoveredItem === 'secondary-cta' ? styles.btnGhostTextHovered : null]}>{homeCopy.secondaryCta}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          <View style={styles.pathSection}>
            <Text style={styles.pathTitle}>{homeCopy.sectionTitle}</Text>
            <View style={styles.moduleCardList}>
              {homeCards.map((card, index) => {
                const isHovered = hoveredItem === `card-${index}`;
                return (
                  <Pressable
                    key={`${card.label}-${card.route}`}
                    accessibilityRole="link"
                    accessibilityLabel={`home-card-${card.label}`}
                    onHoverIn={() => setHoveredItem(`card-${index}`)}
                    onHoverOut={() => setHoveredItem('')}
                    onPress={() => openRoute(card.route)}
                    style={[styles.homeModuleCard, compact ? styles.homeModuleCardCompact : null, isHovered ? styles.homeModuleCardHovered : null]}
                  >
                    <Text
                      data-clearn-role="card-index"
                      style={[styles.homeModuleIndex, isHovered ? styles.homeModuleIndexHovered : null]}
                    >
                      {String(index + 1).padStart(2, '0')} / {String(homeCards.length).padStart(2, '0')}
                    </Text>
                    <View style={styles.homeModuleBody}>
                      <Text
                        data-clearn-role="card-title"
                        style={[styles.homeModuleTitle, isHovered ? styles.homeModuleTitleHovered : null]}
                      >
                        {card.label}
                      </Text>
                      <Text style={styles.homeModuleDescription}>{card.description}</Text>
                    </View>
                    {renderArrow(compact ? 'small' : 'large')}
                  </Pressable>
                );
              })}
            </View>
          </View>

          {loading && !content ? <ActivityIndicator color={tokens.colors.accent} /> : null}
          {error ? (
            <View style={styles.feedbackCard}>
              <Text style={styles.feedbackText}>{getNestedString(ui, ['feedback', 'unableToLoadContentTitle']) || error}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <Text style={styles.watermark}>{getNestedString(ui, ['watermarkText'])}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.colors.background,
  },
  orb: {
    position: 'absolute',
    left: -250,
    top: -160,
    width: 610,
    height: 610,
    borderRadius: 610,
    backgroundColor: tokens.colors.backgroundGlow,
    opacity: 0.22,
  },
  scrollContent: {
    minHeight: '100%',
    paddingHorizontal: 64,
    paddingTop: 32,
    paddingBottom: 64,
  },
  scrollContentCompact: {
    paddingHorizontal: 20,
    paddingTop: 22,
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 1480,
    alignSelf: 'center',
    minHeight: 720,
  },
  homeScrollContent: {
    minHeight: '100%',
    paddingHorizontal: 64,
    paddingTop: 32,
    paddingBottom: 80,
  },
  homeScrollContentCompact: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 44,
  },
  homeShell: {
    flex: 1,
    width: '100%',
    maxWidth: 1480,
    alignSelf: 'center',
  },
  homeShellCompact: {
    maxWidth: 335,
    alignSelf: 'stretch',
  },
  topBar: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  headerLink: {
    width: 54,
    height: 38,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  headerLinkHovered: {
    borderColor: tokens.colors.accent,
  },
  headerLinkLine: {
    width: 18,
    height: 1,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.colors.ink,
  },
  headerLinkLineHovered: {
    backgroundColor: tokens.colors.accent,
  },
  homeHero: {
    paddingTop: 118,
    paddingBottom: 0,
  },
  homeHeroCompact: {
    paddingTop: 52,
  },
  homeHeroWord: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 152,
    lineHeight: 134,
    fontWeight: '700',
    letterSpacing: -7,
  },
  homeHeroWordCompact: {
    fontSize: 62,
    lineHeight: 56,
    letterSpacing: -3,
  },
  homeHeroWordHovered: {
    color: tokens.colors.ink,
    opacity: 1,
  },
  homeHeroAccent: {
    color: tokens.colors.accent,
    fontFamily: tokens.typography.serif,
    fontStyle: 'italic',
    fontWeight: '400',
    letterSpacing: -1,
  },
  homeLead: {
    maxWidth: 660,
    marginTop: 32,
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 24,
    lineHeight: 36,
  },
  homeLeadCompact: {
    fontSize: 18,
    lineHeight: 27,
    marginTop: 24,
    maxWidth: 335,
  },
  homeCtaRow: {
    marginTop: 40,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  btn: {
    minHeight: 56,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: 30,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  btnLarge: {
    paddingVertical: 18,
  },
  btnAccent: {
    backgroundColor: tokens.colors.accent,
    borderColor: tokens.colors.accent,
  },
  btnAccentHovered: {
    backgroundColor: tokens.colors.accentDeep,
    borderColor: tokens.colors.accentDeep,
  },
  btnAccentText: {
    color: tokens.colors.accentContrast,
    fontFamily: tokens.typography.sans,
    fontSize: 16,
    fontWeight: '700',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderColor: tokens.colors.cardLine,
  },
  btnGhostHovered: {
    borderColor: tokens.colors.accent,
    backgroundColor: tokens.colors.accentSoft,
  },
  btnGhostText: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 16,
    fontWeight: '700',
  },
  btnGhostTextHovered: {
    color: tokens.colors.accent,
  },
  pathSection: {
    paddingTop: 72,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.line,
  },
  pathTitle: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '500',
    marginBottom: 40,
  },
  moduleCardList: {
    marginHorizontal: -64,
  },
  homeModuleCard: {
    minHeight: 160,
    paddingVertical: 36,
    paddingHorizontal: 64,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.line,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 32,
  },
  homeModuleCardCompact: {
    flexDirection: 'column',
    marginHorizontal: 44,
    paddingHorizontal: 20,
    gap: 14,
  },
  homeModuleCardHovered: {
    backgroundColor: tokens.colors.surface,
  },
  homeModuleIndex: {
    width: 72,
    paddingTop: 12,
    color: tokens.colors.inkMuted,
    fontFamily: tokens.typography.sans,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.9,
  },
  homeModuleIndexHovered: {
    color: tokens.colors.accent,
  },
  homeModuleBody: {
    flex: 1,
    maxWidth: 900,
  },
  homeModuleTitle: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 40,
    lineHeight: 42,
    fontWeight: '500',
    letterSpacing: -1.4,
    marginBottom: 14,
  },
  homeModuleTitleHovered: {
    color: tokens.colors.accent,
  },
  homeModuleDescription: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 21,
    lineHeight: 32,
    opacity: 0.92,
    maxWidth: 780,
  },
  arrowCircle: {
    width: 56,
    height: 56,
    borderRadius: 56,
    borderWidth: 1,
    borderColor: tokens.colors.inkMuted,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  arrowCircleSmall: {
    width: 44,
    height: 44,
  },
  arrowGlyph: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 16,
    fontWeight: '700',
  },
  menuGrid: {
    flex: 1,
    marginTop: 130,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 80,
  },
  menuGridCompact: {
    marginTop: 80,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 48,
  },
  bigWordsColumn: {
    flex: 1,
    gap: 4,
  },
  bigWordRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 28,
  },
  bigWordNumber: {
    width: 34,
    paddingTop: 20,
    color: 'rgba(245, 241, 234, 0.22)',
    fontFamily: tokens.typography.sans,
    fontSize: 14,
    letterSpacing: 2.2,
    fontWeight: '500',
  },
  bigWordNumberHovered: {
    color: tokens.colors.accent,
  },
  bigWord: {
    color: tokens.colors.inkMuted,
    fontFamily: tokens.typography.sans,
    fontSize: 152,
    lineHeight: 144,
    fontWeight: '700',
    letterSpacing: -7,
  },
  bigWordHovered: {
    color: tokens.colors.ink,
  },
  bigWordCompact: {
    fontSize: 64,
    lineHeight: 62,
    letterSpacing: -3,
  },
  sideMenu: {
    width: 410,
    gap: 28,
    alignSelf: 'flex-end',
    paddingBottom: 24,
  },
  sideGroup: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.cardLine,
    gap: 6,
  },
  sideHeading: {
    color: tokens.colors.inkMuted,
    fontFamily: tokens.typography.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.2,
    marginBottom: 14,
  },
  sideLink: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  sideLinkText: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
  },
  sideLinkTextHovered: {
    color: tokens.colors.accent,
  },
  feedbackCard: {
    marginTop: 30,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    borderRadius: tokens.radius.xl,
    padding: tokens.spacing.md,
    backgroundColor: tokens.colors.surface,
  },
  feedbackText: {
    color: tokens.colors.accent,
  },
  watermark: {
    position: 'absolute',
    right: 10,
    bottom: 8,
    color: tokens.colors.inkMuted,
    opacity: 0.4,
    fontSize: 10,
  },
});
