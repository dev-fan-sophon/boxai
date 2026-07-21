/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ModelIcon } from '@lobehub/icons'

import { getLobeIcon } from '@/lib/lobe-icon'

type ModelBrandIconProps = {
  modelName: string
  icon?: string
  vendorIcon?: string
  size?: number
}

export function ModelBrandIcon(props: ModelBrandIconProps) {
  const iconKey = props.icon?.trim() || props.vendorIcon?.trim()
  const size = props.size ?? 20

  return (
    <span
      aria-hidden='true'
      className='flex shrink-0 items-center justify-center'
    >
      {iconKey ? (
        getLobeIcon(iconKey, size)
      ) : (
        <ModelIcon model={props.modelName} size={size} type='color' />
      )}
    </span>
  )
}
