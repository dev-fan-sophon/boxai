import { cn } from '@/lib/utils'

export type DocAnnotation = {
  x: number
  y: number
  label: string
}

export function DocFigure(props: {
  src: string
  alt: string
  caption?: string
  annotations?: DocAnnotation[]
  className?: string
}) {
  return (
    <figure className={cn('doc-figure my-6', props.className)}>
      <div className='bg-muted/20 relative overflow-hidden rounded-xl border'>
        <img
          src={props.src}
          alt={props.alt}
          loading='lazy'
          className='h-auto w-full'
        />
        {props.annotations?.map((item) => (
          <span
            key={`${item.label}-${item.x}-${item.y}`}
            className='bg-primary text-primary-foreground absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-semibold shadow'
            style={{ left: `${item.x}%`, top: `${item.y}%` }}
          >
            {item.label}
          </span>
        ))}
      </div>
      {props.caption ? (
        <figcaption className='text-muted-foreground mt-2 text-sm leading-relaxed'>
          {props.caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
