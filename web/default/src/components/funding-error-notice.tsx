import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Wallet } from '@/components/icons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getFundingError } from '@/lib/funding-error'

/** Open billing separately so an unfinished generation or chat stays intact. */
export function FundingErrorNotice(props: {
  code?: string
  className?: string
  children?: ReactNode
}) {
  useTranslation()
  const funding = getFundingError(props.code)
  if (!funding) return null
  return (
    <Alert className={props.className}>
      <Wallet className='text-warning' aria-hidden='true' />
      <AlertTitle>{funding.title}</AlertTitle>
      <AlertDescription className='min-w-0 [&_a]:no-underline'>
        <p>{funding.description}</p>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            role='link'
            render={
              <a
                href={funding.href}
                target='_blank'
                rel='noopener noreferrer'
              />
            }
          >
            {funding.action}
          </Button>
          {props.children}
        </div>
      </AlertDescription>
    </Alert>
  )
}
