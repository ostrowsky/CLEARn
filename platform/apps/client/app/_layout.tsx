import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import '../src/theme/webFonts';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
