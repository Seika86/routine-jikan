import { useEffect, useRef } from "react"

export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!("wakeLock" in navigator)) return

    const request = async () => {
      try {
        wakeLockRef.current = await navigator.wakeLock.request("screen")
      } catch {
        // Wake lock request failed (e.g. low battery)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        request()
      }
    }

    request()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      wakeLockRef.current?.release()
    }
  }, [])
}
