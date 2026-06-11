'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react'
import { api, ApiError } from '../../lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  actions?: { tool: string; result: unknown }[]
}

const SUGERENCIAS: Record<string, string[]> = {
  general: [
    'Resumen del negocio hoy',
    '¿Cuántos pedidos pendientes hay?',
  ],
  pedidos: [
    'Hay un cliente nuevo llamado…',
    '¿Cuántos pedidos hay pendientes?',
  ],
  inventario: [
    '¿Qué productos tienen stock bajo?',
    'Busca el producto collar tricolor',
  ],
  redes: [
    'Dame ideas para el próximo post',
    'Sugiere hashtags para mis reels',
    '¿Cuál es mi mejor hora para publicar?',
  ],
  notas: [
    'Crea una nota de reunión',
    'Ayúdame con tareas pendientes',
  ],
}

function ToolBadge({ tool }: { tool: string }) {
  const labels: Record<string, string> = {
    crear_cliente: '👤 Cliente creado',
    crear_pedido: '📦 Pedido creado',
    buscar_producto: '🔍 Producto buscado',
    buscar_cliente: '🔍 Cliente buscado',
    consultar_resumen_negocio: '📊 Datos del negocio',
    consultar_posts_ig: '📸 Posts de Instagram',
    consultar_metricas_ig: '📈 Métricas de Instagram',
    crear_proveedor: '🏭 Proveedor creado',
    buscar_proveedor: '🔍 Proveedor buscado',
    crear_producto: '📦 Producto creado',
    ajustar_stock: '📊 Stock ajustado',
    registrar_abono: '💰 Abono registrado',
    crear_nota: '📝 Nota creada',
    actualizar_estado_pedido: '🔄 Pedido actualizado',
    ver_historial_cliente: '👤 Historial consultado',
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono bg-green-50 border border-green-400 text-green-700 px-1.5 py-0.5 rounded">
      {labels[tool] ?? tool}
    </span>
  )
}

export function AiChat({ context = 'general' }: { context?: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      inputRef.current?.focus()
    }
  }, [open, messages])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const newMessages: Message[] = [...messages, { role: 'user', content }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await api.aiChat(
        newMessages.map((m) => ({ role: m.role, content: m.content })),
        context,
      )
      setMessages([
        ...newMessages,
        { role: 'assistant', content: res.response, actions: res.actions },
      ])
    } catch (err) {
      let msg = 'Error al conectar con la IA.'
      if (err instanceof ApiError) {
        if (err.status === 429 || err.message.toLowerCase().includes('rate limit')) {
          msg = '⏳ Límite diario de IA alcanzado. Intenta de nuevo en unos minutos.'
        } else if (err.status === 503) {
          msg = 'IA temporalmente no disponible. Intenta más tarde.'
        } else {
          msg = err.message
        }
      }
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `❌ ${msg}` },
      ])
    } finally {
      setLoading(false)
    }
  }

  const sugerencias: string[] = SUGERENCIAS[context] ?? SUGERENCIAS.general ?? []

  return (
    <>
      {/* Burbuja flotante */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 bg-black text-white border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)] flex items-center justify-center hover:bg-neutral-800 transition-colors"
        title="Asistente IA"
      >
        {open ? <X size={18} /> : <Sparkles size={18} />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-40 w-80 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col"
          style={{ maxHeight: '70vh' }}>
          {/* Header */}
          <div className="flex items-center gap-2 border-b-2 border-black px-3 py-2 bg-black text-white">
            <Bot size={14} />
            <span className="font-mono font-bold text-xs uppercase flex-1">Asistente IA</span>
            <span className="font-mono text-[9px] text-neutral-400">llama-3.3-70b</span>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 p-3 min-h-[200px]">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-mono text-neutral-500 text-center pt-2">
                  ¿En qué puedo ayudarte?
                </p>
                {sugerencias.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="text-left text-[10px] font-mono border border-neutral-300 px-2 py-1.5 hover:bg-neutral-50 hover:border-black transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[85%] px-2.5 py-1.5 text-xs font-mono leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-black text-white'
                      : 'bg-neutral-100 border border-neutral-300 text-black'
                  }`}
                >
                  {m.content}
                </div>
                {m.actions && m.actions.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-w-[85%]">
                    {m.actions.map((a, j) => (
                      <ToolBadge key={j} tool={a.tool} />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-1.5 text-xs font-mono text-neutral-400">
                <Loader2 size={12} className="animate-spin" />
                Pensando…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t-2 border-black flex items-end gap-1 p-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder="Escribe un mensaje… (Enter para enviar)"
              rows={1}
              className="flex-1 resize-none text-xs font-mono outline-none py-1.5 px-2 border border-neutral-300 focus:border-black min-h-[32px] max-h-24"
              style={{ overflow: 'hidden' }}
              onInput={(e) => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = `${t.scrollHeight}px`
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              className="p-1.5 border-2 border-black bg-black text-white disabled:opacity-40 hover:bg-neutral-800 shrink-0"
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
