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
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import enOverrides from './en-overrides.generated.json'
import en from './locales/en.json'

const fullTranslation = en.translation as Record<string, string>

function createEnglish(translation: Record<string, string>) {
  const instance = createInstance()
  void instance.init({
    resources: { en: { translation } },
    lng: 'en',
    fallbackLng: 'en',
    nsSeparator: false,
    interpolation: { escapeValue: false },
  })
  return instance
}

describe('en-overrides.generated.json', () => {
  it('renders every English key exactly like the full locale bundle', () => {
    const full = createEnglish(fullTranslation)
    const trimmed = createEnglish(enOverrides)

    const divergent = Object.keys(fullTranslation).filter(
      (key) => full.t(key) !== trimmed.t(key)
    )

    expect(divergent).toEqual([])
  })

  it('keeps exactly the entries whose value differs from the key', () => {
    const expected = Object.fromEntries(
      Object.keys(fullTranslation)
        .sort()
        .filter((key) => fullTranslation[key] !== key)
        .map((key) => [key, fullTranslation[key]])
    )

    expect(enOverrides).toEqual(expected)
  })
})
