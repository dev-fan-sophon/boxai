import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { isValidElement } from 'react'

import { Loader2 } from '@/components/icons'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-ui duration-control ease-emphasized outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-safe:active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 data-loading:cursor-progress data-loading:disabled:opacity-80 data-loading:[&>svg:not([data-slot=button-spinner])]:hidden aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Solid brand fill with a top highlight and a contact shadow, so the
        // primary action reads as a physical key rather than a flat swatch.
        default:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.14)] hover:bg-primary/92 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_2px_rgb(0_0_0/0.4)]',
        outline:
          'border-border bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:border-input dark:bg-input/20 dark:hover:bg-input/40',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent aria-expanded:text-accent-foreground',
        ghost:
          'text-foreground/80 hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
        destructive:
          'bg-destructive-subtle text-destructive-subtle-foreground hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-destructive/25',
        link: 'text-primary underline-offset-4 hover:underline',
        // Marketing call to action: brand fill with a warm glow underneath.
        cta: 'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_8px_24px_-8px_var(--brand-glow),0_1px_2px_rgb(0_0_0/0.15)] hover:bg-primary/92 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_12px_32px_-8px_var(--brand-glow),0_1px_2px_rgb(0_0_0/0.15)]',
      },
      size: {
        default:
          'h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 rounded-lg px-3 text-ui in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 gap-2 rounded-xl px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5',
        icon: 'size-9',
        'icon-xs':
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-8 rounded-lg in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-10 rounded-xl',
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
        <Loader2
          weight='bold'
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
