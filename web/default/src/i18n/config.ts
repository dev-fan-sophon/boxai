/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import i18n, { type BackendModule } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import { convertDetectedLanguage } from './languages'
import en from './locales/en.json'

type LocaleModule = { default: { translation: Record<string, string> } }

/**
 * Each locale bundle is ~500 kB, so only the active one is fetched. English
 * stays bundled because it is the fallback for every other language and 79 of
 * its entries differ from their (English source string) keys.
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
    resources: { en },
    partialBundledLanguages: true,
    fallbackLng: 'en',
    supportedLngs: ['en', 'zhCN', 'fr', 'ru', 'ja', 'vi', 'zhTW'],
    load: 'currentOnly',
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      // Browsers report `zh-CN`/`zh-TW`/`zh`; map them onto our `zhCN`/`zhTW`
      // codes (non-Chinese codes pass through for normal supportedLngs matching).
      convertDetectedLanguage,
    },
  })

export default i18n
