import {
  Activity,
  Box,
  FileText,
  FlaskConical,
  Key,
  Laptop,
  LayoutDashboard,
  Lightbulb,
  BadgeDollarSign,
  Plug,
  Radio,
  ServerCog,
  Settings,
  Ticket,
  ClipboardCheck,
  User,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarData } from '@/components/layout/types'
import { ROLE } from '@/lib/roles'

/**
 * Root navigation groups for the application sidebar.
 *
 * Order mirrors Apilio-style console:
 *   Console (Dashboard / Token / Wallet) → Tools (Chat) → Logs → Personal → Admin
 *
 * Visibility is further gated by SidebarModulesAdmin / user sidebar_modules
 * via {@link useSidebarConfig}.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()

  return {
    navGroups: [
      {
        id: 'console',
        title: t('Console'),
        items: [
          {
            title: t('Dashboard'),
            url: '/dashboard/overview',
            activeUrls: ['/dashboard'],
            configUrls: [
              '/dashboard',
              '/dashboard/overview',
              '/dashboard/models',
            ],
            icon: LayoutDashboard,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Wallet'),
            url: '/wallet',
            icon: Wallet,
          },
        ],
      },
      {
        id: 'apps',
        title: t('Apps'),
        items: [
          {
            title: t('BoxAI Connect'),
            url: '/dashboard/connect',
            icon: Plug,
          },
          {
            title: t('BoxAI Desktop'),
            url: '/dashboard/desktop',
            icon: Laptop,
          },
        ],
      },
      {
        id: 'tools',
        title: t('Tools'),
        items: [
          {
            title: t('Chat apps'),
            icon: FlaskConical,
            type: 'chat-presets',
          },
        ],
      },
      {
        id: 'logs',
        title: t('Log monitoring'),
        items: [
          {
            // Personal consumption analytics (always /api/data/self)
            title: t('Analytics'),
            url: '/dashboard/models',
            icon: Activity,
          },
          {
            // Personal usage logs (always /api/log/self)
            title: t('Usage Logs'),
            url: '/usage-logs/common',
            icon: FileText,
          },
        ],
      },
      {
        id: 'personal',
        title: t('Personal'),
        items: [
          {
            title: t('Profile'),
            url: '/profile',
            icon: User,
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            // Platform-wide analytics (admin APIs); separate from console Analytics
            title: t('Site Analytics'),
            url: '/admin/analytics/models',
            icon: Activity,
            requiredRole: ROLE.ADMIN,
          },
          {
            // Platform-wide usage logs (admin APIs); separate from console Usage Logs
            title: t('Site Usage Logs'),
            url: '/admin/usage-logs/common',
            icon: FileText,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Pricing Center'),
            url: '/pricing-center',
            icon: BadgeDollarSign,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Inspiration templates'),
            url: '/inspiration-admin',
            icon: Lightbulb,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            title: t('Top-up Reviews'),
            url: '/topup-reviews',
            icon: ClipboardCheck,
          },
          {
            title: t('System Info'),
            url: '/system-info',
            icon: ServerCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
          },
        ],
      },
    ],
  }
}
