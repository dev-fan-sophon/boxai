import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { getIntegrationProfiles } from '@/features/pricing/api'
import type { IntegrationProfile } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import { DocSearch } from './components/doc-search'
import { docsNavSections, normalizeDocsPath } from './lib/load-doc'

const SECTION_TITLE_KEYS: Record<string, string> = {
  start: 'Get started',
  console: 'Console',
  api: 'API',
  clients: 'Clients',
  playground: 'Playground',
  concepts: 'Concepts',
  admin: 'Admin',
}

function DocsNavigation(props: {
  activePath: string
  profiles: IntegrationProfile[]
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const sections = docsNavSections()
  const protocols = useMemo(() => {
    const groups = new Map<string, IntegrationProfile[]>()
    for (const profile of props.profiles) {
      groups.set(profile.protocol, [
        ...(groups.get(profile.protocol) ?? []),
        profile,
      ])
    }
    return [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )
  }, [props.profiles])

  const linkClass = (path: string) =>
    cn(
      'block rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted',
      path === props.activePath && 'bg-muted text-foreground font-medium'
    )

  return (
    <nav aria-label={t('Documentation')} className='space-y-5'>
      <DocSearch />
      {sections.map((group) => (
        <div key={group.section}>
          <p className='text-muted-foreground mb-1 px-3 text-xs font-semibold uppercase'>
            {t(SECTION_TITLE_KEYS[group.section] ?? group.section)}
          </p>
          {group.pages.map((page) => (
            <Link
              key={page.path}
              to='/docs/$'
              params={{ _splat: page.path }}
              className={linkClass(page.path)}
              onClick={props.onNavigate}
            >
              {page.title}
            </Link>
          ))}
          {group.section === 'api' &&
            protocols.map(([protocol, profiles]) => (
              <div key={protocol} className='mt-2 mb-1'>
                <p className='text-muted-foreground px-3 py-1 text-[11px] font-medium tracking-wide uppercase'>
                  {protocol}
                </p>
                {profiles.map((profile) => {
                  const path = `api/${profile.docs_slug}`
                  return (
                    <Link
                      key={profile.id}
                      to='/docs/$'
                      params={{ _splat: path }}
                      className={linkClass(path)}
                      onClick={props.onNavigate}
                    >
                      {t(profile.name_key)}
                    </Link>
                  )
                })}
              </div>
            ))}
        </div>
      ))}
    </nav>
  )
}

export function DocsShell(props: {
  activePath: string
  children: ReactNode
  toc?: ReactNode
}) {
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const profilesQuery = useQuery({
    queryKey: ['integration-profiles'],
    queryFn: getIntegrationProfiles,
    staleTime: 5 * 60 * 1000,
  })
  const profiles = profilesQuery.data ?? []
  const activePath = normalizeDocsPath(props.activePath)

  return (
    <PublicLayout>
      <div className='mx-auto max-w-7xl px-4 py-6'>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button
                variant='outline'
                className='md:hidden'
                aria-label={t('Open docs navigation')}
              />
            }
          >
            <Menu className='size-4' /> {t('Browse documentation')}
          </SheetTrigger>
          <SheetContent side='left'>
            <SheetHeader>
              <SheetTitle>{t('Documentation')}</SheetTitle>
              <SheetDescription>{t('Browse documentation')}</SheetDescription>
            </SheetHeader>
            <div className='overflow-y-auto px-2 pb-6'>
              <DocsNavigation
                activePath={activePath}
                profiles={profiles}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
        <div className='mt-4 grid gap-10 md:mt-0 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_200px]'>
          <aside className='sticky top-20 hidden max-h-[calc(100vh-6rem)] self-start overflow-y-auto md:block'>
            <DocsNavigation activePath={activePath} profiles={profiles} />
          </aside>
          <main className='max-w-3xl min-w-0 pb-20'>{props.children}</main>
          {props.toc ? (
            <aside className='sticky top-20 hidden max-h-[calc(100vh-6rem)] self-start overflow-y-auto xl:block'>
              {props.toc}
            </aside>
          ) : (
            <div className='hidden xl:block' />
          )}
        </div>
      </div>
    </PublicLayout>
  )
}
