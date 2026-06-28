import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

export type TypographyOwner = { meta?: Record<string, unknown> };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function getTextFontSize(owner: TypographyOwner | null | undefined, field: string): number | undefined {
  const value = asRecord(asRecord(owner?.meta).fontSizes)[field];
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed >= 8 && parsed <= 200 ? parsed : undefined;
}

export function setTextFontSize(owner: TypographyOwner, field: string, rawValue: string) {
  owner.meta = asRecord(owner.meta);
  const fontSizes = asRecord(owner.meta.fontSizes);
  const parsed = Number.parseFloat(rawValue);
  if (!rawValue.trim() || !Number.isFinite(parsed)) {
    delete fontSizes[field];
  } else {
    fontSizes[field] = Math.min(200, Math.max(8, parsed));
  }
  owner.meta.fontSizes = fontSizes;
}

export function textStyle(
  baseStyle: StyleProp<TextStyle>,
  owner: TypographyOwner | null | undefined,
  field: string,
): StyleProp<TextStyle> {
  const fontSize = getTextFontSize(owner, field);
  if (!fontSize) return baseStyle;
  const flat = StyleSheet.flatten(baseStyle) || {};
  const adjustment: TextStyle = { fontSize };
  if (typeof flat.fontSize === 'number' && typeof flat.lineHeight === 'number') {
    adjustment.lineHeight = Math.round((flat.lineHeight * fontSize / flat.fontSize) * 10) / 10;
  }
  return [baseStyle, adjustment];
}

export function getUiTextFontSize(ui: Record<string, unknown>, path: string[]): number | undefined {
  const value = asRecord(ui.fontSizes)[path.join('.')];
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value || ''));
  return Number.isFinite(parsed) && parsed >= 8 && parsed <= 200 ? parsed : undefined;
}

export function setUiTextFontSize(ui: Record<string, unknown>, path: string[], rawValue: string) {
  const fontSizes = asRecord(ui.fontSizes);
  const key = path.join('.');
  const parsed = Number.parseFloat(rawValue);
  if (!rawValue.trim() || !Number.isFinite(parsed)) delete fontSizes[key];
  else fontSizes[key] = Math.min(200, Math.max(8, parsed));
  ui.fontSizes = fontSizes;
}

export function uiTextStyle(ui: Record<string, unknown>, path: string[], baseStyle?: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const fontSize = getUiTextFontSize(ui, path);
  if (!fontSize) return baseStyle;
  const flat = StyleSheet.flatten(baseStyle) || {};
  const adjustment: TextStyle = { fontSize };
  if (typeof flat.fontSize === 'number' && typeof flat.lineHeight === 'number') {
    adjustment.lineHeight = Math.round((flat.lineHeight * fontSize / flat.fontSize) * 10) / 10;
  }
  return [baseStyle, adjustment];
}
