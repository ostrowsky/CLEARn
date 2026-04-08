import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { useContent } from '../../src/hooks/useContent';
import { findSectionByRoute } from '../../src/lib/contentNavigation';
import { getNestedString, getUiConfig } from '../../src/lib/contentMeta';
import { tokens } from '../../src/theme/tokens';

export default function SectionsScreen() {
  const router = useRouter();
  const { content, loading, error } = useContent();
  const home = content?.sections.find((section) => section.id === 'home') ?? content?.sections.find((section) => section.route === '/');
  const ui = getUiConfig(content);

  return (
    <Screen
      appTitle={content?.meta.appTitle}
      brandTagline={getNestedString(ui, ['brandTagline'])}
      footerNote={getNestedString(ui, ['footerNote'])}
      eyebrow={home?.eyebrow ?? ''}
      title={home?.title ?? ''}
      subtitle={home?.summary ?? ''}
    >
      {loading && !content ? <ActivityIndicator color={tokens.colors.accentContrast} /> : null}
      {error ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackTitle}>{getNestedString(ui, ['feedback', 'unableToLoadContentTitle'])}</Text>
          <Text style={styles.feedbackText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.actionStack}>
        {(home?.blocks ?? []).map((block, index) => {
          const targetSection = findSectionByRoute(content, block.route);
          if (!targetSection) {
            return null;
          }

          return (
            <Pressable
              key={block.id}
              style={[styles.actionCard, index === 0 ? styles.primaryAction : null]}
              onPress={() => router.push(`/section/${targetSection.id}`)}
            >
              <Text style={styles.actionTitle}>{block.title}</Text>
              <Text style={styles.actionText}>{block.description}</Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionStack: {
    gap: tokens.spacing.md,
  },
  actionCard: {
    backgroundColor: tokens.colors.surfaceMuted,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
    minHeight: 92,
    justifyContent: 'center',
  },
  primaryAction: {
    backgroundColor: tokens.colors.surface,
  },
  actionTitle: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: tokens.colors.ink,
  },
  actionText: {
    marginTop: tokens.spacing.sm,
    color: tokens.colors.inkSoft,
    lineHeight: 22,
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
