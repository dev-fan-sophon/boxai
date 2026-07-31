import type { SVGProps } from 'react'

import { cn } from '@/lib/utils'

export function IconZalo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      role='img'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      className={cn('[&>path]:stroke-current', className)}
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      {...props}
    >
      <title>Zalo</title>
      <path strokeWidth='0' d='M0 0h24v24H0z' fill='none' />
      <path d='M3 20l1.3 -3.9a9 8 0 1 1 3.4 2.9l-4.7 1z' />
      <path d='M9.5 9h5l-5 5.5h5' />
    </svg>
  )
}
