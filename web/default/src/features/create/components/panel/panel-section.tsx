/** Titled block of the control column; the title doubles as the field label. */
export function PanelSection(props: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className='space-y-2.5'>
      <div className='flex min-h-7 flex-wrap items-center justify-between gap-x-2 gap-y-1'>
        <h3 className='text-foreground/85 text-ui min-w-0 font-semibold'>
          {props.title}
        </h3>
        {props.action}
      </div>
      {props.hint && (
        <p className='text-muted-foreground -mt-1 text-xs'>{props.hint}</p>
      )}
      {props.children}
    </section>
  )
}
