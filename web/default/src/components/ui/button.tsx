import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { isValidElement } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-ui duration-control ease-emphasized outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 data-loading:cursor-progress data-loading:disabled:opacity-80 data-loading:[&>svg:not([data-slot=button-spinner])]:hidden aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:hover:bg-muted',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
        // Marketing call to action. Same radius as default (rounded-lg); gradient
        // tracks brand tokens so it stays legible with light brand colors.
        cta: 'bg-gradient-to-r from-primary to-chart-2 text-primary-foreground shadow-md hover:from-primary/90 hover:to-chart-2/90',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-xs':
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-7 rounded-md in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function isNativeButtonRender(render: ButtonPrimitive.Props['render']) {
  if (!render || !isValidElement(render)) {
    return true
  }

  return render.type === 'button'
}

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * Pending state for async actions. Disables the button, marks it
     * `aria-busy`, and swaps the leading icon for a spinner — so a button that
     * already has an icon keeps its exact width. Text-only buttons gain the
     * spinner in front of the label.
     */
    loading?: boolean
  }

/**
 * Press feedback is owned here (a `scale` on `:active`, skipped for reduced
 * motion and for menu triggers whose popup anchors to the button's box), not
 * by a global `button:active` rule, so raw `<button>`s in custom widgets are
 * not shrunk behind their author's back.
 */
function Button({
  className,
  variant = 'default',
  size = 'default',
  nativeButton,
  render,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot='button'
      data-loading={loading ? '' : undefined}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      nativeButton={nativeButton ?? isNativeButtonRender(render)}
      render={render}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <HugeiconsIcon
          icon={Loading03Icon}
          strokeWidth={2}
          aria-hidden='true'
          data-slot='button-spinner'
          data-icon='inline-start'
          className='animate-spin'
        />
      )}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
