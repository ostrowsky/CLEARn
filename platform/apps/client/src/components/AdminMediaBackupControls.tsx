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
      window.alert('Media backup restore failed.');
      return;
    }

    window.alert('Media backup restored. Refresh admin to see restored media.');
  }

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.button}
        onPress={() => window.open(resolveApiUrl('/api/admin/backup/media/export'), '_blank', 'noopener,noreferrer')}
      >
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
