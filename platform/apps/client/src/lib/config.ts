import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

const productionApiFallbacks: Record<string, string> = {
  'clearn.me': 'https://clearn-api.onrender.com',
  'www.clearn.me': 'https://clearn-api.onrender.com',
};

function guessApiBaseUrl() {
  if (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }

  if (extra.apiBaseUrl) {
    return extra.apiBaseUrl;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, origin, protocol } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const isLanHost = /^(10|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(hostname);

    if (isLocalHost || isLanHost) {
      return `${protocol}//${hostname}:4000`;
    }

    return productionApiFallbacks[hostname] || origin;
  }

  const legacyManifest = (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest;
  const debuggerHost = legacyManifest?.debuggerHost;
  if (debuggerHost) {
    return `http://${debuggerHost.split(':')[0]}:4000`;
  }

  return 'http://localhost:4000';
}

export const apiBaseUrl = guessApiBaseUrl();
