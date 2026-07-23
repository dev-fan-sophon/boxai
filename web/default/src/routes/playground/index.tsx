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
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { PublicLayout } from '@/components/layout'
import { Playground } from '@/features/playground'
import { getFreshModuleAccess } from '@/lib/nav-modules'

export const Route = createFileRoute('/playground/')({
  validateSearch: z.object({
    model: z.string().trim().min(1).max(128).optional(),
  }),
  beforeLoad: async () => {
    const access = await getFreshModuleAccess('playground')
    if (!access.enabled) throw redirect({ to: '/' })
  },
  component: PlaygroundPage,
})

function PlaygroundPage() {
  return (
    <PublicLayout showMainContainer={false}>
      <div className='playground-page h-dvh max-h-dvh overflow-hidden pt-[calc(var(--app-header-height,3.5rem)+env(safe-area-inset-top,0px))]'>
        <Playground />
      </div>
    </PublicLayout>
  )
}
