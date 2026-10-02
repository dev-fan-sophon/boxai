/** Titled block of the control column; the title doubles as the field label. */
export function PanelSection(props: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className='space-y-2'>
      <div className='flex min-h-5 items-center justify-between gap-2'>
        <h3 className='text-muted-foreground text-2xs font-semibold tracking-wide uppercase'>
          {props.title}
        </h3>
        {props.action}
      </div>
      {props.hint && (
        <p className='text-muted-foreground text-2xs -mt-1'>{props.hint}</p>
      )}
      {props.children}
    </section>
  )
}
