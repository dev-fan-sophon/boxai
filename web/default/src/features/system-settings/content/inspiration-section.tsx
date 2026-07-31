import { InspirationAdmin } from '@/features/inspiration-admin'

/** Thin wrapper so content section-registry can lazy-load without cycles. */
export function InspirationSection() {
  return <InspirationAdmin embedded />
}
