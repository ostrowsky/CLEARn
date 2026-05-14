import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
const productionApiBaseUrl = 'https://clearn-api.onrender.com';

function getEnvApiBaseUrl() {
  if (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_BASE_URL) {
    return process.env.EXPO_PUBLIC_API_BASE_URL;
  }

  if (extra.apiBaseUrl) {
    return extra.apiBaseUrl;
  }

  return '';
}

function getLocalWebApiBaseUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    const { hostname, protocol } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    const isLanHost = /^(10|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(hostname);

    if (isLocalHost || isLanHost) {
      return `${protocol}//${hostname}:4000`;
    }
  }

  return '';
}

function guessApiBaseUrl() {
  const localWebApiBaseUrl = getLocalWebApiBaseUrl();
  if (localWebApiBaseUrl) {
    return localWebApiBaseUrl;
  }

  const envApiBaseUrl = getEnvApiBaseUrl();
  if (envApiBaseUrl) {
    return envApiBaseUrl;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    return productionApiBaseUrl;
  }

  const legacyManifest = (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest;
  const debuggerHost = legacyManifest?.debuggerHost;
  if (debuggerHost) {
    return `http://${debuggerHost.split(':')[0]}:4000`;
  }

  return 'http://localhost:4000';
}

export const apiBaseUrl = guessApiBaseUrl();
