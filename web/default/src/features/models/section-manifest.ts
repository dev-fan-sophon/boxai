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
/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const MODELS_SECTION_IDS = ['metadata', 'deployments'] as const

export type ModelsSectionId = (typeof MODELS_SECTION_IDS)[number]

export const MODELS_DEFAULT_SECTION: ModelsSectionId = 'metadata'
