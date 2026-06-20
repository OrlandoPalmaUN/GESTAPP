'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Hash,
  Heart,
  Instagram,
  Loader2,
  MessageCircle,
  RefreshCw,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
import type {
  IgComentario,
  IgCuenta,
  IgHashtagStat,
  IgHeatmapPunto,
  IgPost,
  IgPostDetalle,
  IgPostSnapshot,
  IgResumen,
  IgSnapshotPerfil,
} from '@antigravity/shared'
import { api, ApiError, imgProxyUrl } from '../../lib/api'

// ─── helpers ────────────────────────────────────────────────────────────────

function n(v: number | null | undefined, dec = 0) {
  if (v == null) return '—'
  return v.toLocaleString('es-CO', { maximumFractionDigits: dec })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Versión corta para ejes de gráficas — solo día + mes */
function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ─── Subcomponentes ──────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  icon,
}: {
  label: string
  value: string
  delta?: number | null
  deltaLabel?: string
  icon: React.ReactNode
}) {
  const deltaPositivo = (delta ?? 0) >= 0
  return (
    <div className="neo-card bg-white flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase text-neutral-500 font-bold">{label}</span>
        <span className="text-neutral-400">{icon}</span>
      </div>
      <div className="font-mono font-black text-2xl leading-tight">{value}</div>
      {delta != null && (
        <div className={`flex items-center gap-0.5 font-mono text-[10px] ${deltaPositivo ? 'text-green-700' : 'text-red-600'}`}>
          {deltaPositivo ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          {deltaPositivo ? '+' : ''}{n(delta)} {deltaLabel}
        </div>
      )}
    </div>
  )
}

function SparkLine({ serie }: { serie: IgSnapshotPerfil[] }) {
  if (serie.length < 2) return (
    <div className="text-xs font-mono text-neutral-400 text-center py-4">Sin suficientes datos para la gráfica</div>
  )
  const vals = serie.map((s) => s.seguidores)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const w = 600
  const h = 80
  const points = serie.map((s, i) => {
    const x = (i / (serie.length - 1)) * w
    const y = h - ((s.seguidores - min) / range) * h
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="black" strokeWidth="2" />
      {/* Primer y último punto */}
      {[0, serie.length - 1].map((i) => {
        const s = serie[i]!
        const x = (i / (serie.length - 1)) * w
        const y = h - ((s.seguidores - min) / range) * h
        return <circle key={i} cx={x} cy={y} r="4" fill="black" />
      })}
    </svg>
  )
}

function HeatmapGrid({ data }: { data: IgHeatmapPunto[] }) {
  if (!data.length) return (
    <div className="text-xs font-mono text-neutral-400 text-center py-4">Sin datos suficientes</div>
  )

  const maxEng = Math.max(...data.map((d) => d.engagementPromedio), 1)
  const byKey = Object.fromEntries(data.map((d) => [`${d.diaSemana}-${d.hora}`, d]))
  const horas = [6, 8, 10, 12, 14, 16, 18, 20, 22]

  return (
    <div className="overflow-x-auto">
      <table className="text-[9px] font-mono border-collapse w-full">
        <thead>
          <tr>
            <th className="pr-2 text-right text-neutral-400 font-normal w-8"></th>
            {horas.map((h) => (
              <th key={h} className="text-center text-neutral-500 font-normal px-0.5">{h}h</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DIAS_SEMANA.map((dia, d) => (
            <tr key={d}>
              <td className="pr-2 text-right text-neutral-500 py-0.5">{dia}</td>
              {horas.map((h) => {
                const cell = byKey[`${d}-${h}`]
                const intensity = cell ? cell.engagementPromedio / maxEng : 0
                const bg = intensity > 0.7 ? 'bg-black text-white' :
                           intensity > 0.4 ? 'bg-neutral-600 text-white' :
                           intensity > 0.1 ? 'bg-neutral-200' : 'bg-neutral-50'
                return (
                  <td key={h} title={cell ? `${n(cell.engagementPromedio, 1)} eng prom (${cell.posts} posts)` : 'Sin datos'}
                    className={`${bg} text-center px-1 py-0.5 border border-white cursor-default`}>
                    {cell ? cell.posts : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[9px] font-mono text-neutral-400 mt-1">Número = posts publicados · Color = engagement promedio</p>
    </div>
  )
}

function PostRow({
  post,
  onSelect,
}: {
  post: IgPost
  onSelect: (id: string) => void
}) {
  const preview = post.caption?.slice(0, 80).replace(/\n/g, ' ') ?? ''
  return (
    <button
      type="button"
      onClick={() => onSelect(post.id)}
      className="w-full flex items-center gap-3 border-b border-neutral-200 last:border-b-0 py-2 text-xs text-left hover:bg-neutral-50 transition-colors"
    >
      {/* Tipo badge */}
      <span className="font-mono text-[9px] border border-black px-1 shrink-0 uppercase">{post.tipo}</span>
      {/* Thumbnail */}
      {post.thumbnailUrl && (
        <img src={imgProxyUrl(post.thumbnailUrl)} alt="" className="w-8 h-8 object-cover border border-black shrink-0" />
      )}
      {/* Caption */}
      <span className="text-neutral-700 truncate flex-1">{preview || <em className="text-neutral-400">Sin caption</em>}</span>
      {/* Métricas */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-neutral-600 shrink-0">
        <span className="flex items-center gap-0.5"><Heart size={10} /> {n(post.likes)}</span>
        <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {n(post.comentarios)}</span>
        {post.reproducciones != null && (
          <span className="flex items-center gap-0.5 text-neutral-400" title="Reproducciones">
            ▶ {n(post.reproducciones)}
          </span>
        )}
      </div>
      {/* Fecha */}
      <span className="font-mono text-[10px] text-neutral-400 shrink-0">{fmtDate(post.publicadoEn)}</span>
      <ArrowUpRight size={12} className="text-neutral-300 shrink-0" />
    </button>
  )
}

function PostDrawer({
  postId,
  onClose,
}: {
  postId: string
  onClose: () => void
}) {
  const [post, setPost] = useState<IgPostDetalle | null>(null)
  const [serie, setSerie] = useState<IgPostSnapshot[]>([])
  const [comentarios, setComentarios] = useState<IgComentario[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCom, setFilterCom] = useState<'todos' | 'sin-responder' | 'preguntas'>('todos')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.igPostDetalle(postId),
      api.igComentarios(postId, { filter: filterCom }),
    ]).then(([det, coms]) => {
      setPost(det.post)
      setSerie(det.serie)
      setComentarios(coms.comentarios)
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [postId, filterCom])

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white border-2 border-black w-full max-w-xl max-h-[85vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black px-4 py-3 sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Instagram size={14} />
            <span className="font-mono font-bold text-xs uppercase">Detalle del Post</span>
          </div>
          <button type="button" onClick={onClose} className="hover:bg-neutral-100 p-1 border border-black">
            <X size={14} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : post ? (
          <div className="flex flex-col gap-4 p-4">
            {/* Caption */}
            {post.caption && (
              <p className="text-sm leading-relaxed">{post.caption}</p>
            )}
            {/* Métricas */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Likes', value: n(post.likes) },
                { label: 'Comentarios', value: n(post.comentarios) },
                { label: 'Reproducciones', value: n(post.reproducciones) },
              ].map(({ label, value }) => (
                <div key={label} className="neo-card bg-white p-2 text-center">
                  <div className="font-mono text-[9px] text-neutral-500 uppercase">{label}</div>
                  <div className="font-mono font-black text-lg">{value}</div>
                </div>
              ))}
            </div>
            {/* Sparkline de crecimiento */}
            {serie.length > 1 && (
              <div>
                <h4 className="font-mono text-[10px] uppercase font-bold mb-1">Crecimiento de likes</h4>
                <SparkLine serie={serie.map((s) => ({ ...s, seguidores: s.likes, seguidos: 0, postsTotal: 0, fecha: s.fecha, alcance: null, impresiones: null, profileViews: null }))} />
              </div>
            )}
            {/* Hashtags */}
            {post.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {post.hashtags.map((h) => (
                  <span key={h} className="border border-black font-mono text-[10px] px-1.5 py-0.5">#{h}</span>
                ))}
              </div>
            )}
            {/* Comentarios */}
            <div>
              <div className="flex items-center gap-2 border-b border-black pb-2 mb-2">
                <h4 className="font-mono text-[10px] uppercase font-bold flex-1">Comentarios</h4>
                <div className="flex gap-1">
                  {(['todos', 'sin-responder', 'preguntas'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilterCom(f)}
                      className={`font-mono text-[9px] px-1.5 py-0.5 border border-black ${filterCom === f ? 'bg-black text-white' : 'bg-white'}`}
                    >
                      {f === 'todos' ? 'Todos' : f === 'sin-responder' ? 'Sin responder' : 'Preguntas'}
                    </button>
                  ))}
                </div>
              </div>
              {comentarios.length === 0 ? (
                <p className="text-xs font-mono text-neutral-400 text-center py-3">Sin comentarios</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {comentarios.map((c) => (
                    <div key={c.id} className="border border-neutral-200 p-2 text-xs">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="font-mono font-bold text-[10px]">@{c.autorHandle}</span>
                        {c.autorVerificado && <span className="text-blue-500 text-[9px]">✓</span>}
                        <span className="text-neutral-400 font-mono text-[9px] ml-auto">{fmtDate(c.publicadoEn)}</span>
                        {!c.respondido && (
                          <span className="bg-orange-100 border border-orange-400 text-orange-700 font-mono text-[8px] px-1">sin responder</span>
                        )}
                      </div>
                      <p className="text-neutral-700 leading-snug">{c.texto}</p>
                      {c.likes > 0 && <span className="text-[9px] font-mono text-neutral-400">♥ {c.likes}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Link al post */}
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1 border-2 border-black font-mono text-xs py-2 hover:bg-black hover:text-white transition-colors"
            >
              <Instagram size={12} /> Ver en Instagram <ArrowUpRight size={12} />
            </a>
          </div>
        ) : (
          <div className="p-4 text-sm font-mono text-neutral-500 text-center">Post no encontrado.</div>
        )}
      </div>
    </div>
  )
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

function Onboarding({ onConectado }: { onConectado: () => void }) {
  const [handle, setHandle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!handle.trim()) return
    setLoading(true)
    setError(null)
    try {
      await api.igVincularCuenta(handle.trim())
      onConectado()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al conectar la cuenta.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-10 px-4">
      <div className="flex flex-col items-center gap-2">
        <div className="border-2 border-black p-4 bg-brand-yellow">
          <Instagram size={32} />
        </div>
        <h2 className="font-mono font-black text-lg uppercase">Conecta tu Instagram</h2>
        <p className="text-sm text-neutral-600 font-mono text-center max-w-xs">
          Ingresa el <strong>@handle</strong> de tu cuenta pública de Instagram para
          empezar a ver métricas reales.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full max-w-xs">
        <div className="flex border-2 border-black overflow-hidden">
          <span className="bg-neutral-100 border-r-2 border-black px-3 flex items-center font-mono text-sm text-neutral-500">@</span>
          <input
            className="flex-1 px-3 py-2 font-mono text-sm outline-none"
            placeholder="tu.negocio"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={loading}
          />
        </div>
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border-2 border-red-400 p-2 text-xs text-red-700 font-mono">
            <AlertCircle size={12} />
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !handle.trim()}
          className="neo-btn bg-black text-white font-mono text-sm py-2 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Instagram size={14} />}
          {loading ? 'Conectando…' : 'Conectar cuenta'}
        </button>
        <p className="text-[10px] font-mono text-neutral-400 text-center">
          Solo cuentas públicas. No se requiere contraseña.
        </p>
      </form>
    </div>
  )
}

// ─── Dashboard principal ─────────────────────────────────────────────────────

export function IgDashboard() {
  const [cuenta, setCuenta] = useState<IgCuenta | null | undefined>(undefined) // undefined = loading
  const [resumen, setResumen] = useState<IgResumen | null>(null)
  const [serie, setSerie] = useState<IgSnapshotPerfil[]>([])
  const [posts, setPosts] = useState<IgPost[]>([])
  const [hashtags, setHashtags] = useState<IgHashtagStat[]>([])
  const [heatmap, setHeatmap] = useState<IgHeatmapPunto[]>([])
  const [heatmapDisclaimer, setHeatmapDisclaimer] = useState<string | null>(null)
  const [postSeleccionado, setPostSeleccionado] = useState<string | null>(null)
  const [ordenPosts, setOrdenPosts] = useState<'fecha' | 'engagement'>('fecha')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [errorGlobal, setErrorGlobal] = useState<string | null>(null)
  const cargandoDatos = useRef(false)

  const cargarTodo = useCallback(async () => {
    if (cargandoDatos.current) return
    cargandoDatos.current = true
    try {
      const { cuenta: c } = await api.igCuenta()
      setCuenta(c)
      if (!c) return

      const [res, ser, pos, ht, hm] = await Promise.all([
        api.igResumen(30),
        api.igSeguidores(90),
        api.igPosts({ limit: 30, order: 'fecha' }),
        api.igHashtags(30),
        api.igMejoresHoras(90),
      ])
      setResumen(res.resumen)
      setSerie(ser.serie)
      setPosts(pos.posts)
      setHashtags(ht.hashtags)
      setHeatmap(hm.heatmap)
      setHeatmapDisclaimer(hm.disclaimer)
    } catch (err) {
      setErrorGlobal(err instanceof ApiError ? err.message : 'Error cargando datos.')
    } finally {
      cargandoDatos.current = false
    }
  }, [])

  useEffect(() => { void cargarTodo() }, [cargarTodo])

  // Reordenar posts localmente
  const postsOrdenados = [...posts].sort((a, b) => {
    if (ordenPosts === 'engagement') return (b.likes + b.comentarios) - (a.likes + a.comentarios)
    return new Date(b.publicadoEn).getTime() - new Date(a.publicadoEn).getTime()
  })

  async function handleRefresh() {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const r = await api.igRefresh()
      if (!r.async) {
        setRefreshMsg(`✅ ${r.postsActualizados ?? 0} posts y ${r.comentariosActualizados ?? 0} comentarios actualizados.`)
        await cargarTodo()
        setRefreshing(false)
        return
      }

      // Modo asíncrono: la API persiste el run en apify_scrape_runs y
      // expone GET /redes/ig/refresh-status. Hacemos polling cada 5s
      // hasta que el run termine (succeeded o failed), con un techo de
      // 3 minutos para no quedar girando si algo se atascó.
      setRefreshMsg(`⏳ ${r.mensaje ?? 'Actualización en proceso…'}`)

      const inicioPolling = Date.now()
      const TECHO_MS = 3 * 60 * 1000

      while (Date.now() - inicioPolling < TECHO_MS) {
        await new Promise((res) => setTimeout(res, 5000))
        try {
          const { run } = await api.igRefreshStatus()
          if (!run) break
          if (run.status === 'succeeded') {
            setRefreshMsg(`✅ Datos actualizados (${run.itemsCount ?? 0} posts).`)
            await cargarTodo()
            return
          }
          if (run.status === 'failed') {
            setRefreshMsg(`❌ Falló el scrape: ${run.errorMessage ?? 'error desconocido'}.`)
            return
          }
          // running → seguir polling
        } catch (err) {
          // Si falla el status no rompemos el ciclo — puede ser un blip
          if (err instanceof ApiError && err.status >= 500) continue
          throw err
        }
      }
      setRefreshMsg('⏱ El scrape está tardando más de lo esperado — recarga la página en unos minutos.')
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setRefreshMsg(`⏳ ${err.message}`)
      } else {
        setRefreshMsg(`❌ ${err instanceof ApiError ? err.message : 'Error al actualizar.'}`)
      }
    } finally {
      setRefreshing(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (cuenta === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" />
      </div>
    )
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────
  if (cuenta === null) {
    return <Onboarding onConectado={() => { setCuenta(undefined); void cargarTodo() }} />
  }

  // ── Error global ──────────────────────────────────────────────────────────
  if (errorGlobal) {
    return (
      <div className="flex items-center gap-2 bg-red-50 border-2 border-red-400 p-3 text-sm font-mono text-red-700">
        <AlertCircle size={14} /> {errorGlobal}
      </div>
    )
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Instagram size={16} />
          <span className="font-mono font-bold text-sm">@{cuenta.handle}</span>
          {cuenta.esVerificada && <span className="text-blue-500 text-xs">✓</span>}
          {cuenta.lastScrapedAt && (
            <span className="font-mono text-[10px] text-neutral-400">
              · Actualizado {fmtDate(cuenta.lastScrapedAt)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="flex items-center gap-1 border-2 border-black font-mono text-[10px] px-2 py-1 hover:bg-black hover:text-white transition-colors disabled:opacity-50"
        >
          {refreshing ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
          Actualizar
        </button>
      </div>

      {refreshMsg && (
        <div className="font-mono text-xs border border-black px-3 py-2 bg-neutral-50">{refreshMsg}</div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Seguidores"
          value={n(resumen?.seguidores ?? cuenta.seguidores)}
          delta={resumen?.deltaSeguidores}
          deltaLabel="(30d)"
          icon={<Users size={14} />}
        />
        <KpiCard
          label="ER promedio"
          value={resumen ? `${n(resumen.erPromedio, 2)}%` : '—'}
          icon={<TrendingUp size={14} />}
        />
        <KpiCard
          label="Posts (30d)"
          value={n(resumen?.totalPosts)}
          icon={<Instagram size={14} />}
        />
        <KpiCard
          label="Comentarios (30d)"
          value={n(resumen?.totalComentarios)}
          icon={<MessageCircle size={14} />}
        />
      </div>

      {/* Gráfica seguidores */}
      <div className="neo-card bg-white p-3 flex flex-col gap-2">
        <h3 className="font-mono font-bold text-xs uppercase border-b border-black pb-2">
          Crecimiento de seguidores — últimos 90 días
        </h3>
        <SparkLine serie={serie} />
        {serie.length > 0 && (
          <div className="flex justify-between font-mono text-[9px] text-neutral-400">
            <span>{serie[0] ? fmtDateShort(String(serie[0].fecha)) : ''}</span>
            <span>{serie[serie.length - 1] ? fmtDateShort(String(serie[serie.length - 1]!.fecha)) : ''}</span>
          </div>
        )}
      </div>

      {/* Posts top */}
      <div className="neo-card bg-white p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 border-b border-black pb-2">
          <h3 className="font-mono font-bold text-xs uppercase flex-1">Publicaciones</h3>
          <div className="flex gap-1">
            {(['fecha', 'engagement'] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOrdenPosts(o)}
                className={`font-mono text-[9px] px-1.5 py-0.5 border border-black ${ordenPosts === o ? 'bg-black text-white' : 'bg-white'}`}
              >
                {o === 'fecha' ? 'Recientes' : 'Engagement'}
              </button>
            ))}
          </div>
        </div>
        {postsOrdenados.length === 0 ? (
          <p className="text-xs font-mono text-neutral-400 text-center py-4">
            Sin posts aún — los datos llegarán en unos minutos.
          </p>
        ) : (
          postsOrdenados.slice(0, 15).map((p) => (
            <PostRow key={p.id} post={p} onSelect={setPostSeleccionado} />
          ))
        )}
      </div>

      {/* Hashtags */}
      {hashtags.length > 0 && (
        <div className="neo-card bg-white p-3 flex flex-col gap-2">
          <h3 className="font-mono font-bold text-xs uppercase border-b border-black pb-2 flex items-center gap-1">
            <Hash size={12} /> Top hashtags (30d)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {hashtags.slice(0, 15).map((h) => (
              <div key={h.hashtag} className="flex items-center gap-1 border border-black px-2 py-0.5">
                <span className="font-mono text-xs font-bold">#{h.hashtag}</span>
                <span className="font-mono text-[9px] text-neutral-500">
                  · {n(Math.round(h.engagementPromedio))} eng
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heatmap mejores horas */}
      <div className="neo-card bg-white p-3 flex flex-col gap-2">
        <h3 className="font-mono font-bold text-xs uppercase border-b border-black pb-2">
          Mejores horas para publicar
        </h3>
        <HeatmapGrid data={heatmap} />
        {heatmapDisclaimer && (
          <p className="text-[10px] font-mono text-orange-700 bg-orange-50 border border-orange-300 px-2 py-1">
            ⚠ {heatmapDisclaimer}
          </p>
        )}
      </div>

      {/* Banner Meta Graph */}
      <div className="border-2 border-dashed border-neutral-300 p-3 flex items-start gap-2 text-xs font-mono text-neutral-500">
        <AlertCircle size={14} className="mt-0.5 shrink-0 text-neutral-400" />
        <span>
          <strong>Alcance, impresiones y guardados</strong> no están disponibles en modo público.
          Conecta una cuenta <strong>Instagram Business</strong> vía Meta Graph API para desbloquearlos.
        </span>
      </div>

      {/* Drawer de post */}
      {postSeleccionado && (
        <PostDrawer postId={postSeleccionado} onClose={() => setPostSeleccionado(null)} />
      )}
    </div>
  )
}
