import { createFileRoute } from '@tanstack/react-router'

import { PrivacyPolicy } from '@/features/legal'

export const Route = createFileRoute('/_public/privacy-policy')({
  component: PrivacyPolicy,
})
