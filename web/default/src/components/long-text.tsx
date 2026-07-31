import { useEffect, useRef, useState } from 'react'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type LongTextProps = {
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

export function LongText({
  children,
  className = '',
  contentClassName = '',
}: LongTextProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isOverflown, setIsOverflown] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const updateOverflow = () => {
      setIsOverflown(checkOverflow(element))
    }

    updateOverflow()

    // Re-check when the content (e.g. language switch) or the
    // container size changes, not only on mount.
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(element)
    return () => observer.disconnect()
  }, [children])

  if (!isOverflown) {
    return (
      <div ref={ref} className={cn('truncate', className)}>
        {children}
      </div>
    )
  }

  return (
    <>
      <div className='hidden sm:block'>
        <TooltipProvider delay={0}>
          <Tooltip>
            <TooltipTrigger
              render={<div ref={ref} className={cn('truncate', className)} />}
            >
              {children}
            </TooltipTrigger>
            <TooltipContent>
              <p className={contentClassName}>{children}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className='sm:hidden'>
        <Popover>
          <PopoverTrigger
            render={<div ref={ref} className={cn('truncate', className)} />}
          >
            {children}
          </PopoverTrigger>
          <PopoverContent className={cn('w-fit', contentClassName)}>
            <p>{children}</p>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}

const checkOverflow = (textContainer: HTMLDivElement | null) => {
  if (textContainer) {
    return (
      textContainer.offsetHeight < textContainer.scrollHeight ||
      textContainer.offsetWidth < textContainer.scrollWidth
    )
  }
  return false
}
