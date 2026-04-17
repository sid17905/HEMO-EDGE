/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Compliance & Security color tokens  (HIPAA / GDPR / audit UI)
// ─────────────────────────────────────────────────────────────────────────────

export const ComplianceColors = {
  /** HIPAA audit banner — authoritative blue */
  hipaaBlue:        '#00478d',
  hipaaBlueLight:   '#e8f0fb',
  hipaaBlueBorder:  '#b3ccf0',

  /** GDPR erasure action — alert red */
  gdprRed:          '#ba1a1a',
  gdprRedLight:     '#ffdad6',
  gdprRedBorder:    '#f5b8b4',

  /** PII scrub toggle — caution amber */
  piiAmber:         '#7d5700',
  piiAmberLight:    '#ffefd6',
  piiAmberBorder:   '#f5d9a0',

  /** Consent / processing basis — verified green */
  consentGreen:     '#006d3a',
  consentGreenLight:'#dcfce7',
  consentGreenBorder:'#86efac',

  /** Audit log entry — neutral slate */
  auditSlate:       '#424752',
  auditSlateLight:  '#f0f1f3',
  auditSlateBorder: '#d4d6db',

  /** Critical / urgent flag */
  critical:         '#ba1a1a',
  criticalLight:    '#ffdad6',

  /** Data residency indicator */
  residencyPurple:  '#5b21b6',
  residencyLight:   '#ede9fe',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Role-based UI palettes
// ─────────────────────────────────────────────────────────────────────────────

export const RolePalette = {
  doctor: {
    primary:     '#00478d',
    primaryLight:'#e8f0fb',
    accent:      '#0369a1',
    accentLight: '#e0f2fe',
    surface:     '#ffffff',
    background:  '#f7f9fb',
  },
  patient: {
    primary:     '#5b21b6',
    primaryLight:'#ede9fe',
    accent:      '#7c3aed',
    accentLight: '#f3f0ff',
    surface:     '#ffffff',
    background:  '#faf9ff',
  },
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});