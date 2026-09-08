import { useEffect, useState } from 'react'

export function useOrderExpired(expiresAt?: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  return !!expiresAt && expiresAt * 1000 <= now
}
