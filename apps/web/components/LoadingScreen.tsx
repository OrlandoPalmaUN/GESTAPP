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

/**
 * El backend vive en el plan gratuito de Render: si nadie lo usó en 15
 * minutos se apaga, y despertarlo tarda hasta ~1 minuto. Ese primer request
 * (siempre `/auth/me`, al abrir la app) es el que paga ese costo — un refresh
 * inmediato después ya pega contra el servidor despierto y es instantáneo.
 *
 * Por debajo de este umbral seguimos con las frases de "cargando tal cosa"
 * de siempre — a esa velocidad es indistinguible de una carga normal. Pasado
 * el umbral, mentir con "casi listo" en loop generaba la sensación de que la
 * app estaba rota; a partir de acá el mensaje pasa a ser honesto sobre POR
 * QUÉ tarda, así quien espera sabe que no se colgó.
 */
const UMBRAL_DESPERTAR_MS = 7000
const MENSAJE_DESPERTANDO = 'Despertando el servidor (puede tardar ~1 min)'

export function LoadingScreen() {
  const statusRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let i = 0
    let despertando = false
    const inicio = Date.now()
    const interval = setInterval(() => {
      const el = statusRef.current
      if (!el) return
      if (!despertando && Date.now() - inicio >= UMBRAL_DESPERTAR_MS) {
        despertando = true
        el.style.opacity = '0'
        setTimeout(() => {
          const el2 = statusRef.current
          if (!el2) return
          el2.textContent = MENSAJE_DESPERTANDO
          el2.style.opacity = '1'
        }, 220)
        return
      }
      if (despertando) return
      i = (i + 1) % MESSAGES.length
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
