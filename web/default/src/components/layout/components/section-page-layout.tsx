import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

import { Main } from './main'
import { PageFooterProvider } from './page-footer'

type SlotProps = { children?: ReactNode }

function SectionPageLayoutTitle(_props: SlotProps) {
  return null
}
SectionPageLayoutTitle.displayName = 'SectionPageLayout.Title'

function SectionPageLayoutActions(_props: SlotProps) {
  return null
}
SectionPageLayoutActions.displayName = 'SectionPageLayout.Actions'

function SectionPageLayoutContent(_props: SlotProps) {
  return null
}
SectionPageLayoutContent.displayName = 'SectionPageLayout.Content'

function SectionPageLayoutBreadcrumb(_props: SlotProps) {
  return null
}
SectionPageLayoutBreadcrumb.displayName = 'SectionPageLayout.Breadcrumb'

export type SectionPageLayoutProps = {
  children: ReactNode
  fixedContent?: boolean
}

export function SectionPageLayout(props: SectionPageLayoutProps) {
  const [footerContainer, setFooterContainer] = useState<HTMLDivElement | null>(
    null
  )

  let title: ReactNode = null
  let actions: ReactNode = null
  let content: ReactNode = null
  let breadcrumb: ReactNode = null

  Children.forEach(props.children, (node) => {
    if (!isValidElement(node)) return
    const child = node as ReactElement<SlotProps>
    if (child.type === SectionPageLayoutTitle) title = child.props.children
    else if (child.type === SectionPageLayoutActions) {
      actions = child.props.children
    } else if (child.type === SectionPageLayoutContent) {
      content = child.props.children
    } else if (child.type === SectionPageLayoutBreadcrumb) {
      breadcrumb = child.props.children
    }
  })

  return (
    <PageFooterProvider container={footerContainer}>
      <Main>
        <div className='border-border/60 shrink-0 border-b px-4 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4'>
          {breadcrumb != null && (
            <div className='mb-1.5 sm:mb-2'>{breadcrumb}</div>
          )}
          <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:gap-x-4'>
            <div className='min-w-[min(100%,14rem)] flex-1'>
              <h2 className='truncate text-lg font-semibold tracking-tight sm:text-xl'>
                {title}
              </h2>
            </div>
            {actions != null && (
              <div className='flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2'>
                {actions}
              </div>
            )}
          </div>
        </div>

        <div
          className={
            props.fixedContent
              ? 'min-h-0 flex-1 overflow-hidden px-4 pt-4 pb-4 sm:px-6 sm:pt-5 sm:pb-5'
              : 'min-h-0 flex-1 overflow-auto px-4 pt-4 pb-4 sm:px-6 sm:pt-5 sm:pb-5'
          }
        >
          {content}
        </div>

        <div
          ref={setFooterContainer}
          className='bg-background/80 shrink-0 border-t px-4 py-2.5 backdrop-blur empty:hidden sm:px-6 sm:py-3'
        />
      </Main>
    </PageFooterProvider>
  )
}

SectionPageLayout.Title = SectionPageLayoutTitle
SectionPageLayout.Actions = SectionPageLayoutActions
SectionPageLayout.Content = SectionPageLayoutContent
SectionPageLayout.Breadcrumb = SectionPageLayoutBreadcrumb
