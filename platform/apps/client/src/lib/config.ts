import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

function guessApiBaseUrl() {
  if (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }

  if (extra.apiBaseUrl) {
    return extra.apiBaseUrl;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }

  const legacyManifest = (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest;
  const debuggerHost = legacyManifest?.debuggerHost;
  if (debuggerHost) {
    return `http://${debuggerHost.split(':')[0]}:4000`;
  }

  return 'http://localhost:4000';
}

export const apiBaseUrl = guessApiBaseUrl();
