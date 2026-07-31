import { api } from '@/lib/api'

/**
 * First-touch marketing attribution.
 *
 * The value is captured on the very first page a visitor lands on and handed to
 * the server, which stores it in a same-site cookie. Signup then reads that
 * cookie, which is what makes OAuth work: the provider callback never runs the
 * SPA, so anything kept only in browser storage would be lost by the time the
 * account row is created.
 */
const ATTRIBUTION_STORAGE_KEY = 'boxai_attribution_v1'

interface Attribution {
  utm_source: string
  utm_medium: string
  utm_campaign: string
  referrer: string
}

function readCapturedAttribution(): Attribution | null {
  const params = new URLSearchParams(window.location.search)
  const utmSource = params.get('utm_source') ?? ''
  const utmMedium = params.get('utm_medium') ?? ''
  const utmCampaign = params.get('utm_campaign') ?? ''

  let referrer = ''
  if (document.referrer) {
    try {
      const url = new URL(document.referrer)
      if (url.host !== window.location.host) referrer = url.host + url.pathname
    } catch {
      referrer = ''
    }
  }

  if (!utmSource && !utmMedium && !utmCampaign && !referrer) return null
  return {
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    referrer,
  }
}

/**
 * Captures attribution once per browser and forwards it to the server. Failures
 * are swallowed: attribution is analytics data and must never block the app.
 */
export function captureAttribution() {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY)) return
    const attribution = readCapturedAttribution()
    if (!attribution) return
    window.localStorage.setItem(
      ATTRIBUTION_STORAGE_KEY,
      JSON.stringify(attribution)
    )
    void api.post('/api/acquisition/track', attribution).catch(() => undefined)
  } catch {
    // Storage can be unavailable in private browsing; attribution is optional.
  }
}
