import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { resolveApiUrl } from '../lib/api';
import { tokens } from '../theme/tokens';

function pickMediaBackupFile() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise<{ fileName: string; base64: string } | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve({ fileName: file.name, base64: String(reader.result || '') });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function getDownloadFileName(response: Response) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || `clearn-media-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

async function readErrorMessage(response: Response) {
  try {
    const payload = await response.json();
    return payload.message || payload.error || response.statusText || String(response.status);
  } catch {
    return response.statusText || String(response.status);
  }
}

async function downloadMediaBackup() {
  const response = await fetch(resolveApiUrl('/api/admin/backup/media/export'), {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    window.alert(`Media backup download failed: ${await readErrorMessage(response)}`);
    return;
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = getDownloadFileName(response);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function AdminMediaBackupControls() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  if (window.location.pathname !== '/admin') {
    return null;
  }

  async function restoreMediaBackup() {
    const file = await pickMediaBackupFile();
    if (!file) {
      return;
    }

    const response = await fetch(resolveApiUrl('/api/admin/backup/media/import'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.fileName, base64: file.base64 }),
    });

    if (!response.ok) {
      window.alert(`Media backup restore failed: ${await readErrorMessage(response)}`);
      return;
    }

    window.alert('Media backup restored. Refresh admin to see restored media.');
  }

  return (
    <View style={styles.row}>
      <Pressable style={styles.button} onPress={() => void downloadMediaBackup()}>
        <Text style={styles.buttonText}>Download media backup</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => void restoreMediaBackup()}>
        <Text style={styles.buttonText}>Restore media backup</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.sm,
  },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: tokens.colors.cardLine,
  },
  buttonText: {
    color: tokens.colors.ink,
    fontWeight: '800',
  },
});
