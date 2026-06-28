import { type Href, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { tokens } from '../theme/tokens';

type BrandLogoProps = {
  href?: Href;
  compact?: boolean;
  fontSize?: number;
};

export function BrandLogo({ href = '/', compact = false, fontSize }: BrandLogoProps) {
  const router = useRouter();

  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(href)} style={styles.link}>
      <Text style={[styles.logo, compact ? styles.logoCompact : null, fontSize ? { fontSize } : null]}>
        <Text style={styles.accent}>{'<'}</Text>
        <Text style={styles.word}>CLEAR</Text>
        <Text style={styles.script}>n</Text>
        <Text style={styles.accent}>{' />'}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: 'flex-start',
  },
  logo: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  logoCompact: {
    fontSize: 14,
    letterSpacing: 0.8,
  },
  word: {
    color: tokens.colors.ink,
    fontFamily: tokens.typography.sans,
    fontWeight: '900',
  },
  script: {
    color: tokens.colors.accent,
    fontFamily: tokens.typography.serif,
    fontStyle: 'italic',
    fontWeight: '400',
  },
  accent: {
    color: tokens.colors.accent,
    fontFamily: tokens.typography.sans,
    fontWeight: '800',
  },
});
