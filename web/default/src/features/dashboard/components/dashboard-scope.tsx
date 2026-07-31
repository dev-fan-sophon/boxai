/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'

/**
 * Dashboard analytics data scope.
 *
 * - `self`: personal consumption only (`/api/data/self`, console entry)
 * - `site`: platform-wide admin view (`/api/data`, admin entry)
 *
 * Scope is chosen by route, not by role alone, so admins still get a true
 * personal console when they open the console Analytics page.
 */
export type DashboardDataScope = 'self' | 'site'

interface DashboardScopeContextValue {
  scope: DashboardDataScope
  /** True when this page should call site-wide admin analytics APIs. */
  isSiteWide: boolean
}

const DashboardScopeContext = createContext<DashboardScopeContextValue>({
  scope: 'self',
  isSiteWide: false,
})

export function DashboardScopeProvider(props: {
  scope: DashboardDataScope
  children: ReactNode
}) {
  return (
    <DashboardScopeContext.Provider
      value={{
        scope: props.scope,
        isSiteWide: props.scope === 'site',
      }}
    >
      {props.children}
    </DashboardScopeContext.Provider>
  )
}

export function useDashboardScope(): DashboardScopeContextValue {
  return useContext(DashboardScopeContext)
}
