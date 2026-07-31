import { SystemInfo } from '@/features/system-info'

/** Thin wrapper so operations section-registry can lazy-load without cycles. */
export function OperationsSystemInfoSection() {
  return <SystemInfo embedded />
}
