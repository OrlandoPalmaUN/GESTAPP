'use client'

import { useEffect, useRef } from 'react'

const MESSAGES = [
  'Conectando con el servidor',
  'Cargando inventario',
  'Cargando pedidos y envíos',
  'Calculando finanzas',
  'Actualizando alertas',
  'Casi listo',
]

export function LoadingScreen() {
  const statusRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let i = 0
    const interval = setInterval(() => {
      i = (i + 1) % MESSAGES.length
      const el = statusRef.current
      if (!el) return
      el.style.opacity = '0'
      setTimeout(() => {
        const el2 = statusRef.current
        if (!el2) return
        el2.textContent = MESSAGES[i] ?? 'Cargando'
        el2.style.opacity = '1'
      }, 220)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="loading-screen-root">
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: '#0c0c0c',
          color: '#fff',
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          fontWeight: 700,
          fontSize: '22px',
          letterSpacing: '1px',
          padding: '9px 16px',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ opacity: 0.55 }}>{'// '}</span>
        GESTAPP
      </div>

      <div className="loading-seg" />

      <span
        ref={statusRef}
        style={{
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          fontSize: '12px',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          color: '#8a8780',
          transition: 'opacity 0.22s ease',
        }}
      >
        {MESSAGES[0]}
      </span>
    </div>
  )
}
