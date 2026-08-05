import i18n, { type BackendModule } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import enOverrides from './en-overrides.generated.json'
import { convertDetectedLanguage } from './languages'

type LocaleModule = { default: { translation: Record<string, string> } }

/**
 * Each locale bundle is ~500 kB, so only the active one is fetched. English is
 * the fallback for every other language, but its keys are the English source
 * strings and i18next returns the key on a miss, so only the 69 entries that
 * differ from their key need to be bundled (see scripts/gen-en-overrides.mjs).
 */
const localeLoaders: Record<string, () => Promise<LocaleModule>> = {
  zhCN: () => import('./locales/zh.json'),
  zhTW: () => import('./locales/zh-TW.json'),
  fr: () => import('./locales/fr.json'),
  ru: () => import('./locales/ru.json'),
  ja: () => import('./locales/ja.json'),
  vi: () => import('./locales/vi.json'),
}

const lazyLocaleBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  // i18next only awaits the returned promise when `read` declares exactly two
  // parameters; with any other arity it waits on a callback instead and the
  // load never settles.
  read: async (language, _namespace) => {
    const load = localeLoaders[language]
    if (!load) return {}
    const module = await load()
    return module.default.translation
  },
}

export const i18nReady = i18n
  .use(lazyLocaleBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: enOverrides } },
    partialBundledLanguages: true,
    // Vietnam-first: default UI language is Vietnamese. English stays the
    // translation fallback because locale keys are English source strings.
    lng: 'vi',
    fallbackLng: 'en',
    supportedLngs: ['vi', 'en', 'zhCN', 'fr', 'ru', 'ja', 'zhTW'],
    load: 'currentOnly',
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    detection: {
      // Only honor an explicit prior choice. New visitors get `lng: 'vi'`
      // (Vietnam-first); do not auto-switch from the browser language.
      order: ['localStorage'],
      caches: ['localStorage'],
      // Browsers report `zh-CN`/`zh-TW`/`zh`; map them onto our `zhCN`/`zhTW`
      // codes (non-Chinese codes pass through for normal supportedLngs matching).
      convertDetectedLanguage,
    },
  })

export default i18n
