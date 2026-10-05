import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

interface TurnstileProps {
  siteKey: string
  onVerify: (token: string) => void
  onExpire?: () => void
  className?: string
}

export function Turnstile(props: TurnstileProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { siteKey, onVerify, onExpire } = props

  useEffect(() => {
    let widgetId: string | undefined
    let disposed = false
    const render = () => {
      if (disposed || widgetId || !ref.current || !window.turnstile) return
      try {
        widgetId = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerify(token),
          'error-callback': () => onExpire?.(),
          'expired-callback': () => onExpire?.(),
          'timeout-callback': () => onExpire?.(),
        })
      } catch {
        /* empty */
      }
    }

    const scriptId = 'cf-turnstile'
    let script = document.querySelector<HTMLScriptElement>(`#${scriptId}`)
    if (window.turnstile) {
      render()
    } else if (!script) {
      script = document.createElement('script')
      script.id = scriptId
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script?.addEventListener('load', render)

    return () => {
      disposed = true
      script?.removeEventListener('load', render)
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId)
      }
    }
  }, [siteKey, onVerify, onExpire])

  return <div ref={ref} className={props.className} />
}
