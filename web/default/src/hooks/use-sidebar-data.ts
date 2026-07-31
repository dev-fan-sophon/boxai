import {
  Activity,
  Box,
  FileText,
  FlaskConical,
  Key,
  LayoutDashboard,
  BadgeDollarSign,
  Radio,
  Settings,
  User,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarData } from '@/components/layout/types'
import {
  BoxAIConnectIcon,
  BoxAIDesktopIcon,
} from '@/features/client-apps/icons'
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
            title: t('Billing'),
            url: '/billing',
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
            icon: BoxAIConnectIcon,
          },
          {
            title: t('BoxAI Desktop'),
            url: '/dashboard/desktop',
            icon: BoxAIDesktopIcon,
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
            // Commerce surface: model pricing (root) + redemption / top-up
            // reviews (admin+). Entry is admin-visible; tab-level guards keep
            // pricing/payment tabs root-only.
            title: t('Pricing Center'),
            url: '/pricing-center',
            activeUrls: ['/pricing-center'],
            configUrls: [
              '/pricing-center',
              '/pricing-center/redemption',
              '/pricing-center/topup-reviews',
            ],
            icon: BadgeDollarSign,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Users'),
            url: '/users/overview',
            activeUrls: ['/users'],
            icon: Users,
          },
          {
            // Nested drill-in also hosts inspiration templates (Content) and
            // cluster System Info (Operations). Keep a single root entry.
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
