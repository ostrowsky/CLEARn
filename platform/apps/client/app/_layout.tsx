import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Analytics } from '@vercel/analytics/react';
import '../src/theme/webFonts';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
      <Analytics />
    </>
  );
}
