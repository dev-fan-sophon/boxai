import type { IconBaseProps } from 'react-icons'

import { PAYMENT_ICON_REGISTRY } from '@/lib/payment-icons'

type ReactIconByNameProps = IconBaseProps & {
  name?: string | null
}

export function ReactIconByName({ name, ...props }: ReactIconByNameProps) {
  const Icon = name ? PAYMENT_ICON_REGISTRY[name.trim()] : undefined
  if (!Icon) return null
  return <Icon {...props} />
}
