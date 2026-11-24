'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { LoadingScreen } from './LoadingScreen'

const MIN_MS = 700

/**
 * Páginas que no dependen de la sesión y por eso no esperan al `/auth/me`.
 *
 * La política de privacidad es pública por obligación: la lee gente sin cuenta
 * —incluido un revisor de Meta, que la exige para habilitar el canal de
 * WhatsApp— y el gate la dejaría mirando un spinner mientras el API responde.
 * Con el API dormido en el plan free de Render, eso es casi un minuto de
 * pantalla de carga en una página que no necesita nada del backend.
 */
const RUTAS_PUBLICAS = ['/privacidad']

export function LoadingGate({ children }: { children: ReactNode }) {
  const { cargando } = useAuth()
  const pathname = usePathname()
  const [minElapsed, setMinElapsed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_MS)
    return () => clearTimeout(t)
  }, [])

  if (RUTAS_PUBLICAS.includes(pathname)) return <>{children}</>
  if (cargando || !minElapsed) return <LoadingScreen />
  return <>{children}</>
}
