import { createContext, useContext } from 'react'

import type { useWorkspaceBootstrap } from '@/features/playground/hooks/use-workspace-bootstrap'

export type CreateWorkspace = ReturnType<typeof useWorkspaceBootstrap>

export const CreateWorkspaceContext = createContext<CreateWorkspace | null>(
  null
)

/** Account scope, catalog and auth gate shared by every studio page. */
export function useCreateWorkspace(): CreateWorkspace {
  const workspace = useContext(CreateWorkspaceContext)
  if (!workspace) {
    throw new Error('useCreateWorkspace must be used inside the create layout')
  }
  return workspace
}
