'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { LoadingScreen } from './LoadingScreen'

const MIN_MS = 700

export function LoadingGate({ children }: { children: ReactNode }) {
  const { cargando } = useAuth()
  const [minElapsed, setMinElapsed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_MS)
    return () => clearTimeout(t)
  }, [])

  if (cargando || !minElapsed) return <LoadingScreen />
  return <>{children}</>
}
