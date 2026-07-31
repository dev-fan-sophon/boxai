import type { SVGProps } from 'react'

import { cn } from '@/lib/utils'

export function IconGoogle({ className, ...props }: SVGProps<SVGSVGElement>) {
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
      <title>Google</title>
      <path strokeWidth='0' d='M0 0h24v24H0z' fill='none' />
      <path d='M17.788 5.108a9 9 0 1 0 3.212 6.892h-8' />
    </svg>
  )
}
