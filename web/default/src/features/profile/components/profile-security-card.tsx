import { ChevronRight, Key, Shield, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useDialogs } from '@/hooks/use-dialog'
import { MOTION_SPRING, MOTION_TRANSITION } from '@/lib/motion'
import { cn } from '@/lib/utils'

import type { UserProfile } from '../types'
import { AccessTokenDialog } from './dialogs/access-token-dialog'
import { ChangePasswordDialog } from './dialogs/change-password-dialog'
import { DeleteAccountDialog } from './dialogs/delete-account-dialog'
import { ProfileSectionLabel } from './profile-surface'

interface ProfileSecurityCardProps {
  profile: UserProfile | null
  loading: boolean
}

type DialogKey = 'password' | 'token' | 'delete'

export function ProfileSecurityCard({
  profile,
  loading,
}: ProfileSecurityCardProps) {
  const { t } = useTranslation()
  const dialogs = useDialogs<DialogKey>()

  if (loading) {
    return (
      <div>
        <ProfileSectionLabel
          title={t('Security')}
          description={t('Manage your security settings and account access')}
        />
        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
          {['password', 'token', 'delete'].map((key) => (
            <Skeleton key={key} className='h-28 w-full rounded-2xl' />
          ))}
        </div>
      </div>
    )
  }

  if (!profile) return null

  const securityActions = [
    {
      icon: Shield,
      title: t('Change Password'),
      description: t('Update your password to keep your account secure'),
      action: () => dialogs.open('password'),
      tone: 'success' as const,
      variant: 'default' as const,
    },
    {
      icon: Key,
      title: t('Access Token'),
      description: t('Generate and manage your API access token'),
      action: () => dialogs.open('token'),
      tone: 'info' as const,
      variant: 'default' as const,
    },
    {
      icon: Trash2,
      title: t('Delete Account'),
      description: t('Permanently delete your account and all data'),
      action: () => dialogs.open('delete'),
      tone: 'destructive' as const,
      variant: 'destructive' as const,
    },
  ]

  return (
    <>
      <ProfileSectionLabel
        title={t('Security')}
        description={t('Manage your security settings and account access')}
      />
      <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
        {securityActions.map((item, index) => (
          <motion.button
            key={item.title}
            type='button'
            onClick={item.action}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...MOTION_TRANSITION.fast, delay: index * 0.04 }}
            whileHover={{ y: -2, transition: MOTION_SPRING.smooth }}
            whileTap={{ scale: 0.98, transition: MOTION_SPRING.snappy }}
            className={cn(
              'group/sec border-border/50 bg-card/80 relative flex flex-col gap-3 rounded-2xl border p-4 text-left shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_4%,transparent)] backdrop-blur-sm transition-[border-color,background-color,box-shadow] duration-control',
              'hover:border-border hover:bg-card focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              item.variant === 'destructive' &&
                'hover:border-destructive/40 hover:bg-destructive/5'
            )}
          >
            <div className='flex items-start justify-between gap-2'>
              <IconBadge
                tone={item.tone}
                size='md'
                className='duration-control transition-transform group-hover/sec:scale-105'
              >
                <item.icon />
              </IconBadge>
              <ChevronRight className='text-muted-foreground transition-ui duration-control size-4 opacity-0 group-hover/sec:translate-x-0.5 group-hover/sec:opacity-100' />
            </div>
            <div className='min-w-0 space-y-1'>
              <p
                className={cn(
                  'text-sm font-semibold tracking-tight',
                  item.variant === 'destructive' && 'text-destructive'
                )}
              >
                {item.title}
              </p>
              <p className='text-muted-foreground line-clamp-2 text-xs leading-relaxed'>
                {item.description}
              </p>
            </div>
          </motion.button>
        ))}
      </div>

      <ChangePasswordDialog
        open={dialogs.isOpen('password')}
        onOpenChange={(open) =>
          open ? dialogs.open('password') : dialogs.close('password')
        }
        username={profile.username}
      />

      <AccessTokenDialog
        open={dialogs.isOpen('token')}
        onOpenChange={(open) =>
          open ? dialogs.open('token') : dialogs.close('token')
        }
      />

      <DeleteAccountDialog
        open={dialogs.isOpen('delete')}
        onOpenChange={(open) =>
          open ? dialogs.open('delete') : dialogs.close('delete')
        }
        username={profile.username}
      />
    </>
  )
}
