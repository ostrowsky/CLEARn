import type { PropsWithChildren } from 'react';
import { type Href, useRouter } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
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
}>;

export function Screen({
  appTitle,
  brandTagline,
  eyebrow,
  title,
  subtitle,
  backHref,
  backLabel,
  footerNote,
  children,
}: ScreenProps) {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View pointerEvents="none" style={styles.backdrop}>
        <View style={styles.glowTop} />
        <View style={styles.glowBottom} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.shell}>
          <View style={styles.topRow}>
            <View style={styles.brandWrap}>
              {appTitle ? <Text style={styles.brandText}>{appTitle}</Text> : null}
              {brandTagline ? <Text style={styles.topLink}>{brandTagline}</Text> : null}
            </View>

            {backHref ? (
              <Pressable style={styles.backButton} onPress={() => router.push(backHref)}>
                <Text style={styles.backText}>{backLabel ?? ''}</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.heroCard}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>

          {children}

          {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
        </View>
      </ScrollView>
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
    top: -120,
    left: -80,
    width: 340,
    height: 340,
    borderRadius: 340,
    backgroundColor: tokens.colors.backgroundGlow,
    opacity: 0.18,
  },
  glowBottom: {
    position: 'absolute',
    right: -100,
    bottom: -120,
    width: 320,
    height: 320,
    borderRadius: 320,
    backgroundColor: tokens.colors.backgroundDeep,
    opacity: 0.34,
  },
  scrollContent: {
    paddingVertical: tokens.spacing.lg,
    paddingHorizontal: tokens.spacing.md,
  },
  shell: {
    width: '100%',
    maxWidth: 1220,
    alignSelf: 'center',
    gap: tokens.spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacing.sm,
  },
  brandWrap: {
    gap: 4,
    minHeight: 22,
  },
  brandText: {
    color: tokens.colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  topLink: {
    color: tokens.colors.inkSoft,
    fontSize: 13,
  },
  backButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  backText: {
    color: tokens.colors.ink,
    fontWeight: '700',
  },
  heroCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.xl,
    padding: 22,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  eyebrow: {
    marginBottom: tokens.spacing.xs,
    color: tokens.colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  subtitle: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
    fontSize: 15,
  },
  footerNote: {
    textAlign: 'center',
    color: tokens.colors.inkSoft,
    paddingBottom: tokens.spacing.sm,
  },
});
