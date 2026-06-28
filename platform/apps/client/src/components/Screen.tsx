import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { type Href, useRouter } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, View, useWindowDimensions, Pressable, Text, type StyleProp, type TextStyle } from 'react-native';

import { BrandLogo } from './BrandLogo';
import { useContent } from '../hooks/useContent';
import { getNestedRecord, getUiConfig } from '../lib/contentMeta';
import { uiTextStyle } from '../lib/contentTypography';
import { tokens } from '../theme/tokens';

type ScreenProps = PropsWithChildren<{
  appTitle?: string;
  brandTagline?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  backHref?: Href;
  backLabel?: string;
  footerNote?: string;
  watermarkText?: string;
  eyebrowStyle?: StyleProp<TextStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
}>;

function getTitleParts(title: string) {
  const matchers: Array<{ pattern: RegExp; accent: string }> = [
    { pattern: /How to Ask Better Questions After a Presentation/i, accent: 'Better Questions' },
    { pattern: /How to Structure Questions Correctly/i, accent: 'Correctly' },
    { pattern: /10-question mixed session/i, accent: 'mixed' },
    { pattern: /Open the live learning chat/i, accent: 'coach' },
  ];
  const matcher = matchers.find((item) => item.pattern.test(title));
  if (!matcher) {
    return [{ text: title, accent: false }];
  }

  if (matcher.accent === 'coach') {
    return [
      { text: 'Talk to the ', accent: false },
      { text: 'coach', accent: true },
      { text: '.', accent: false },
    ];
  }

  const index = title.toLowerCase().indexOf(matcher.accent.toLowerCase());
  if (index < 0) {
    return [{ text: title, accent: false }];
  }

  return [
    { text: title.slice(0, index), accent: false },
    { text: title.slice(index, index + matcher.accent.length), accent: true },
    { text: title.slice(index + matcher.accent.length), accent: false },
  ].filter((part) => part.text);
}

type MenuItem = {
  label: string;
  route: string;
};

const fallbackSkillMenu: MenuItem[] = [
  { label: 'Interrupt and ask', route: '/asking/interrupt' },
  { label: 'Ask after the talk', route: '/asking/after-talk' },
  { label: 'Question formation drill', route: '/asking/without-context' },
  { label: '10-question mixed session', route: '/answering/mixed' },
];

const fallbackAboutMenu: MenuItem[] = [
  { label: 'How it works', route: '/' },
  { label: 'For teams', route: '/' },
  { label: 'Contact', route: '/' },
];
const menuWordLinks: Array<{ word: string; route: string }> = [
  { word: 'ASK', route: '/asking' },
  { word: 'ANSWER', route: '/answering' },
  { word: 'CHAT', route: '/learning-chat' },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asMenuItems(value: unknown, fallback: MenuItem[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const items = value
    .map((item): MenuItem | null => {
      const record = asRecord(item);
      const label = asString(record.label);
      const route = asString(record.route);
      return label && route ? { label, route } : null;
    })
    .filter((item): item is MenuItem => item !== null);

  return items.length ? items : fallback;
}

function useLearnerMenuHoverStyles() {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const styleId = 'clearn-learner-menu-hover';
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      [role="button"],
      [role="link"],
      [tabindex="0"]:not(input):not(textarea) {
        cursor: pointer;
        transition:
          border-color 160ms ease,
          background-color 160ms ease,
          color 160ms ease,
          opacity 160ms ease,
          filter 160ms ease,
          box-shadow 160ms ease;
      }

      [role="button"]:hover,
      [role="link"]:not([aria-label^="learner-menu-word-"]):hover,
      [tabindex="0"]:not(input):not(textarea):not([aria-label^="learner-menu-word-"]):hover {
        border-color: ${tokens.colors.accent} !important;
        box-shadow: inset 0 0 0 1px ${tokens.colors.accent} !important;
        filter: brightness(1.08);
      }

      [role="button"]:hover [dir="auto"],
      [role="link"]:not([aria-label^="learner-menu-word-"]):hover [dir="auto"] {
        color: ${tokens.colors.accent} !important;
      }

      [role="button"]:hover,
      [tabindex="0"]:not(input):not(textarea):hover {
        background-color: ${tokens.colors.surfaceStrong} !important;
      }

      [aria-label^="learner-menu-word-"] {
        cursor: pointer;
      }

      [aria-label^="learner-menu-word-"]:hover {
        border-color: transparent !important;
        box-shadow: none !important;
        filter: none !important;
      }

      [aria-label^="learner-menu-word-"]:hover [dir="auto"] {
        color: ${tokens.colors.ink} !important;
      }

      [aria-label^="learner-menu-word-"][tabindex="0"]:hover [dir="auto"] {
        color: ${tokens.colors.ink} !important;
      }

      [aria-label^="learner-menu-word-"]:hover [dir="auto"]:first-child {
        color: ${tokens.colors.accent} !important;
      }

      [aria-label^="learner-menu-word-"][tabindex="0"]:hover [dir="auto"]:first-child {
        color: ${tokens.colors.accent} !important;
      }

      [aria-label^="learner-menu-skill-"]:hover [dir="auto"],
      [aria-label^="learner-menu-about-"]:hover [dir="auto"] {
        color: ${tokens.colors.accent} !important;
      }

      [aria-label="learner-menu-button"]:hover {
        border-color: ${tokens.colors.accent} !important;
      }

      [aria-label="learner-menu-button"]:hover [dir="auto"] {
        background-color: ${tokens.colors.accent} !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);
}

export function Screen({
  appTitle,
  brandTagline,
  eyebrow,
  title,
  subtitle,
  footerNote,
  watermarkText,
  eyebrowStyle,
  titleStyle,
  subtitleStyle,
  children,
}: ScreenProps) {
  const router = useRouter();
  const { content } = useContent();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const titleParts = getTitleParts(title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoveredMenuWord, setHoveredMenuWord] = useState('');
  useLearnerMenuHoverStyles();
  const ui = getUiConfig(content);
  const homeMenu = getNestedRecord(ui, ['homeMenu']);
  const skillMenu = asMenuItems(homeMenu.skills, fallbackSkillMenu);
  const aboutMenu = asMenuItems(homeMenu.about, fallbackAboutMenu);
  const skillsHeading = asString(homeMenu.skillsHeading, 'SKILLS');
  const aboutHeading = asString(homeMenu.aboutHeading, 'ABOUT');
  const menuTriggerLabel = asString(homeMenu.menuTriggerLabel, 'ASK ANSWER chat');

  function openMenuRoute(route: string) {
    setMenuOpen(false);
    router.push(route as Href);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View pointerEvents="none" style={styles.backdrop}>
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, compact ? styles.scrollContentCompact : null]}>
        <View style={styles.shell}>
          <View style={styles.topRow}>
            <View style={styles.brandWrap}>
              {appTitle ? <BrandLogo compact /> : null}
              {brandTagline ? <Text style={uiTextStyle(ui, ['brandTagline'], styles.topLink)}>{brandTagline}</Text> : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="learner-menu-button"
              accessibilityHint={menuTriggerLabel}
              style={styles.menuPill}
              onPress={() => setMenuOpen((current) => !current)}
            >
              <Text data-clearn-role="learner-menu-trigger-line" style={styles.menuPillLine} />
              <Text data-clearn-role="learner-menu-trigger-line" style={styles.menuPillLine} />
              <Text data-clearn-role="learner-menu-trigger-line" style={styles.menuPillLine} />
            </Pressable>
          </View>

          {menuOpen ? (
            <View style={[styles.menuOverlay, compact ? styles.menuOverlayCompact : null]}>
              <View style={styles.menuWords}>
                {menuWordLinks.map((item, index) => (
                  <Pressable
                    key={item.word}
                    accessibilityRole="link"
                    accessibilityLabel={`learner-menu-word-${item.word}`}
                    style={styles.menuWordRow}
                    onHoverIn={() => setHoveredMenuWord(item.word)}
                    onHoverOut={() => setHoveredMenuWord('')}
                    onPointerEnter={() => setHoveredMenuWord(item.word)}
                    onPointerLeave={() => setHoveredMenuWord('')}
                    onPress={() => openMenuRoute(item.route)}
                  >
                    <Text style={[styles.menuWordIndex, hoveredMenuWord === item.word ? styles.menuWordIndexHovered : null]}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <Text style={[styles.menuWord, compact ? styles.menuWordCompact : null, hoveredMenuWord === item.word ? styles.menuWordHovered : null]}>
                      {item.word}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.menuLists}>
                <View style={styles.menuList}>
                  <Text style={styles.menuHeading}>{skillsHeading}</Text>
                  {skillMenu.map((item) => (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`learner-menu-skill-${item.label}`}
                      key={`${item.label}-${item.route}`}
                      onPress={() => openMenuRoute(item.route)}
                    >
                      <Text style={styles.menuLink}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.menuList}>
                  <Text style={styles.menuHeading}>{aboutHeading}</Text>
                  {aboutMenu.map((item) => (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`learner-menu-about-${item.label}`}
                      key={`${item.label}-${item.route}`}
                      onPress={() => openMenuRoute(item.route)}
                    >
                      <Text style={styles.menuLink}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.heroCard, compact ? styles.heroCardCompact : null]}>
                {eyebrow ? <Text style={[styles.eyebrow, eyebrowStyle]}>{eyebrow}</Text> : null}
                <Text style={[styles.title, compact ? styles.titleCompact : null, titleStyle]}>
                  {titleParts.map((part, index) => (
                    <Text key={`${part.text}-${index}`} style={part.accent ? styles.titleAccent : null}>
                      {part.text}
                    </Text>
                  ))}
                </Text>
                {subtitle ? <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text> : null}
              </View>

              {children}

              {footerNote ? <Text style={uiTextStyle(ui, ['footerNote'], styles.footerNote)}>{footerNote}</Text> : null}
            </>
          )}
        </View>
      </ScrollView>
      {watermarkText ? (
        <View pointerEvents="none" style={styles.watermark}>
          <Text style={uiTextStyle(ui, ['watermarkText'], styles.watermarkText)}>{watermarkText}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.colors.background,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  glowTop: {
    position: 'absolute',
    top: -260,
    left: -180,
    width: 720,
    height: 720,
    borderRadius: 720,
    backgroundColor: tokens.colors.backgroundGlow,
    opacity: 0.1,
  },
  glowBottom: {
    position: 'absolute',
    right: -180,
    bottom: -220,
    width: 520,
    height: 520,
    borderRadius: 520,
    backgroundColor: tokens.colors.accent,
    opacity: 0.06,
  },
  scrollContent: {
    paddingTop: 34,
    paddingBottom: 72,
    paddingHorizontal: 40,
  },
  scrollContentCompact: {
    paddingTop: 22,
    paddingBottom: 48,
    paddingHorizontal: 20,
  },
  shell: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    gap: 42,
    zIndex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacing.sm,
  },
  brandWrap: {
    gap: 6,
    minHeight: 38,
  },
  topLink: {
    color: tokens.colors.inkMuted,
    fontFamily: tokens.typography.sans,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  menuPill: {
    width: 54,
    height: 38,
    borderRadius: tokens.radius.pill,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: tokens.colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  menuPillLine: {
    width: 18,
    height: 1,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.colors.ink,
  },
  menuOverlay: {
    marginTop: 88,
    marginBottom: 28,
    minHeight: 500,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 88,
  },
  menuOverlayCompact: {
    marginTop: 56,
    minHeight: 640,
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 36,
  },
  menuWords: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 640,
    gap: 2,
  },
  menuWordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  menuWordIndex: {
    width: 32,
    color: tokens.colors.inkDim,
    fontFamily: tokens.typography.sans,
    fontSize: 14,
    letterSpacing: 1.2,
  },
  menuWordIndexHovered: {
    color: tokens.colors.accent,
  },
  menuWord: {
    color: tokens.colors.inkDim,
    fontFamily: tokens.typography.sans,
    fontSize: 112,
    lineHeight: 112,
    fontWeight: '900',
    letterSpacing: -5,
  },
  menuWordHovered: {
    color: tokens.colors.ink,
  },
  menuWordCompact: {
    fontSize: 68,
    lineHeight: 70,
    letterSpacing: -2,
  },
  menuLists: {
    width: 360,
    flexShrink: 0,
    gap: 34,
  },
  menuList: {
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.line,
    gap: 14,
  },
  menuHeading: {
    color: tokens.colors.inkDim,
    fontFamily: tokens.typography.sans,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '800',
  },
  menuLink: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 17,
    lineHeight: 24,
  },
  heroCard: {
    maxWidth: 980,
    paddingTop: 20,
    paddingBottom: 8,
  },
  heroCardCompact: {
    paddingTop: 10,
    paddingBottom: 0,
  },
  eyebrow: {
    marginBottom: 18,
    fontFamily: tokens.typography.sans,
    color: tokens.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    fontSize: 12,
    fontWeight: '800',
  },
  title: {
    fontFamily: tokens.typography.sans,
    fontSize: 60,
    lineHeight: 61,
    fontWeight: '500',
    letterSpacing: -1.5,
    color: tokens.colors.ink,
  },
  titleCompact: {
    fontSize: 34,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -0.8,
  },
  titleAccent: {
    color: tokens.colors.accent,
    fontFamily: tokens.typography.serif,
    fontStyle: 'italic',
    fontWeight: '400',
  },
  subtitle: {
    marginTop: 18,
    maxWidth: 780,
    fontFamily: tokens.typography.sans,
    color: tokens.colors.inkSoft,
    lineHeight: 25,
    fontSize: 17,
  },
  footerNote: {
    textAlign: 'center',
    color: tokens.colors.inkSoft,
    paddingBottom: tokens.spacing.sm,
  },
  watermark: {
    position: 'absolute',
    right: 10,
    bottom: 8,
    opacity: 0.42,
  },
  watermarkText: {
    color: tokens.colors.inkSoft,
    fontSize: 10,
  },
});
