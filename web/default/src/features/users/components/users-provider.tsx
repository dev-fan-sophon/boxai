import React, { useState } from 'react'

import { useDialogState } from '@/hooks/use-dialog'

import type { User, UserQueryFilter, UsersDialogType } from '../types'

type UsersContextType = {
  open: UsersDialogType | null
  setOpen: (str: UsersDialogType | null) => void
  currentRow: User | null
  setCurrentRow: React.Dispatch<React.SetStateAction<User | null>>
  refreshTrigger: number
  triggerRefresh: () => void
  /** Advanced audience predicates layered on top of the URL-backed filters. */
  advancedFilter: UserQueryFilter
  setAdvancedFilter: React.Dispatch<React.SetStateAction<UserQueryFilter>>
  /** User whose 360 profile drawer is open, or null when it is closed. */
  profileUserId: number | null
  setProfileUserId: React.Dispatch<React.SetStateAction<number | null>>
}

const UsersContext = React.createContext<UsersContextType | null>(null)

export function UsersProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useDialogState<UsersDialogType>(null)
  const [currentRow, setCurrentRow] = useState<User | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [advancedFilter, setAdvancedFilter] = useState<UserQueryFilter>({})
  const [profileUserId, setProfileUserId] = useState<number | null>(null)

  const triggerRefresh = () => setRefreshTrigger((prev) => prev + 1)

  return (
    <UsersContext
      value={{
        open,
        setOpen,
        currentRow,
        setCurrentRow,
        refreshTrigger,
        triggerRefresh,
        advancedFilter,
        setAdvancedFilter,
        profileUserId,
        setProfileUserId,
      }}
    >
      {children}
    </UsersContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUsers = () => {
  const usersContext = React.useContext(UsersContext)

  if (!usersContext) {
    throw new Error('useUsers has to be used within <UsersContext>')
  }

  return usersContext
}
