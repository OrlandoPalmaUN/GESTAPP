'use client'

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'

type Instruccion = 'mejorar' | 'formal' | 'resumir' | 'bullet'

const OPCIONES: { value: Instruccion; label: string; emoji: string }[] = [
  { value: 'mejorar',  label: 'Mejorar',  emoji: '✨' },
  { value: 'formal',   label: 'Formalizar', emoji: '👔' },
  { value: 'resumir',  label: 'Resumir',  emoji: '📝' },
  { value: 'bullet',   label: 'Viñetas',  emoji: '•' },
]

interface Props {
  texto: string
  onAplicar: (nuevoTexto: string) => void
}

export function AiNotasHelper({ texto, onAplicar }: Props) {
  const [loading, setLoading] = useState<Instruccion | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  async function handleClick(instruccion: Instruccion) {
    if (!texto.trim() || loading) return
    setLoading(instruccion)
    setPreview(null)
    try {
      const { resultado } = await api.aiNotas(texto, instruccion)
      setPreview(resultado)
    } catch {
      setPreview('Error al procesar. Intenta de nuevo.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Botones de acción */}
      <div className="flex items-center gap-1 flex-wrap">
        <Sparkles size={11} className="text-neutral-400 shrink-0" />
        {OPCIONES.map((op) => (
          <button
            key={op.value}
            type="button"
            onClick={() => void handleClick(op.value)}
            disabled={!!loading || !texto.trim()}
            className="flex items-center gap-0.5 text-[10px] font-mono border border-neutral-300 px-1.5 py-0.5 hover:border-black hover:bg-neutral-50 disabled:opacity-40 transition-colors"
          >
            {loading === op.value
              ? <Loader2 size={9} className="animate-spin" />
              : <span>{op.emoji}</span>
            }
            {op.label}
          </button>
        ))}
      </div>

      {/* Preview del resultado */}
      {preview && (
        <div className="border border-black bg-neutral-50 p-2 flex flex-col gap-2">
          <p className="text-[10px] font-mono text-neutral-500 uppercase">Sugerencia IA</p>
          <p className="text-xs font-mono leading-relaxed whitespace-pre-wrap">{preview}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { onAplicar(preview); setPreview(null) }}
              className="text-[10px] font-mono border-2 border-black bg-black text-white px-2 py-0.5 hover:bg-neutral-800"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-[10px] font-mono border border-neutral-300 px-2 py-0.5 hover:border-black"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
