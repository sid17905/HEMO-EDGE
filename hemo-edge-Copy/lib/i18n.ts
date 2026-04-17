// FILE: lib/i18n.ts
// Phase 5 — Pillar H: Internationalisation
//
// Stack: i18next + react-i18next
// Supported locales: en, hi, mr, ta, te, bn
// Auto-detected from device on first launch.
// Manual override persisted in /userPreferences/{userId}.language (Pillar B).
//
// Usage in components:
//   import { useTranslation } from '@/lib/i18n';
//   const { t } = useTranslation();
//   <Text>{t('tabs.home')}</Text>
//
// Language change from Settings:
//   import { changeLanguage } from '@/lib/i18n';
//   await changeLanguage('hi');
//   await saveUserPreferences(uid, { language: 'hi' }, role);

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

// ── Locale JSON bundles ────────────────────────────────────────────────────────
import en from '../assets/locales/en/common.json';
import hi from '../assets/locales/hi/common.json';
import mr from '../assets/locales/mr/common.json';
import ta from '../assets/locales/ta/common.json';
import te from '../assets/locales/te/common.json';
import bn from '../assets/locales/bn/common.json';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SupportedLocale = 'en' | 'hi' | 'mr' | 'ta' | 'te' | 'bn';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  mr: 'मराठी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  bn: 'বাংলা',
};

// ── Device locale → SupportedLocale mapping ───────────────────────────────────
//
// expo-localization returns BCP-47 tags like 'en-IN', 'hi-IN', 'mr-IN', etc.
// We match on the primary subtag only.

const LOCALE_MAP: Record<string, SupportedLocale> = {
  en: 'en',
  hi: 'hi',
  mr: 'mr',
  ta: 'ta',
  te: 'te',
  bn: 'bn',
};

function detectDeviceLocale(): SupportedLocale {
  try {
    const locales = Localization.getLocales();
    const primary = locales[0]?.languageCode ?? 'en';
    return LOCALE_MAP[primary] ?? 'en';
  } catch {
    return 'en';
  }
}

// ── Initialise ─────────────────────────────────────────────────────────────────
//
// This module is imported once at the app entry point (app/_layout.tsx).
// After the first import, i18n.language is set and all subsequent
// useTranslation() calls resolve synchronously from the in-memory resource store.

const detectedLocale = detectDeviceLocale();

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en, common: en },
      hi: { translation: hi, common: hi },
      mr: { translation: mr, common: mr },
      ta: { translation: ta, common: ta },
      te: { translation: te, common: te },
      bn: { translation: bn, common: bn },
    },
    lng:          detectedLocale,
    fallbackLng:  'en',
    // 'translation' is the i18next default NS — keeps t('key') working without
    // explicit namespace prefix. 'common' is also registered so that callers
    // who use t('key', { ns: 'common' }) or useTranslation('common') still work.
    defaultNS:    'translation',
    ns:           ['translation', 'common'],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    // Resources are loaded synchronously (bundled JSON) — no async backend needed.
    initAsync: false,
  });

// ── Public API ─────────────────────────────────────────────────────────────────

export { i18n };

// Re-export useTranslation so callers import from a single place
export { useTranslation } from 'react-i18next';

/**
 * Programmatically change the active language.
 * Call this from Settings when the user selects a locale,
 * then persist the choice with saveUserPreferences().
 */
export async function changeLanguage(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
}

/**
 * Returns the currently active locale.
 */
export function getCurrentLocale(): SupportedLocale {
  return (i18n.language as SupportedLocale) ?? 'en';
}