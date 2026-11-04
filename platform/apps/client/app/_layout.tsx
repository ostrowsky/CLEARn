import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import '../src/theme/webFonts';
import { AnalyticsConsent } from '../src/components/analytics/AnalyticsConsent';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
      <AnalyticsConsent />
    </>
  );
}
