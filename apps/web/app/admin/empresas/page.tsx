'use client'

import type { PlanId, Tenant } from '@antigravity/shared'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Building2, LogOut, Plus, ShieldCheck, Users,
  X, ChevronRight, AlertTriangle, CheckCircle
} from 'lucide-react'

import { api, ApiError } from '../../../lib/api'
import { useAuth } from '../../../lib/auth-context'

const PLANES: { value: PlanId; label: string; precio: string }[] = [
  { value: 'basico',      label: 'Básico',      precio: '$79.000/mes'  },
  { value: 'profesional', label: 'Profesional', precio: '$189.000/mes' },
  { value: 'empresarial', label: 'Empresarial', precio: '$390.000/mes' },
]

const ETIQUETA_ESTADO: Record<Tenant['status'], string> = {
  active:    'ACTIVA',
  suspended: 'SUSPENDIDA',
  cancelled: 'CANCELADA',
}

const ESTILO_ESTADO: Record<Tenant['status'], string> = {
  active:    'bg-brand-sage/60 text-green-800 border border-green-700',
  suspended: 'bg-brand-yellow/30 text-neutral-800 border border-brand-yellow',
  cancelled: 'bg-neutral-200 text-neutral-600 border border-neutral-400',
}

function slugificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function AdminEmpresasPage() {
  const router = useRouter()
  const { usuario: yo, cargando: cargandoSesion, logout } = useAuth()

  const [tenants, setTenants] = useState<Tenant[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mostrarForm, setMostrarForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocadoManualmente, setSlugTocadoManualmente] = useState(false)
  const [plan, setPlan] = useState<PlanId>('basico')
  const [enviando, setEnviando] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const { tenants } = await api.listarTenants()
      setTenants(tenants)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la lista de empresas.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    if (cargandoSesion) return
    if (!yo) { router.replace('/login'); return }
    if (yo.rol !== 'superadmin') { router.replace('/admin/usuarios'); return }
    void cargar()
  }, [cargandoSesion, yo, router, cargar])

  function onChangeName(value: string) {
    setName(value)
    if (!slugTocadoManualmente) setSlug(slugificar(value))
  }

  async function crearTenant(e: FormEvent) {
    e.preventDefault()
    setErrorForm(null)
    setEnviando(true)
    try {
      await api.crearTenant({ name, slug, plan })
      setSuccessMsg(`Empresa "${name}" creada correctamente.`)
      setName(''); setSlug(''); setSlugTocadoManualmente(false); setPlan('basico')
      setMostrarForm(false)
      await cargar()
      setTimeout(() => setSuccessMsg(null), 4000)
    } catch (err) {
      setErrorForm(err instanceof ApiError ? err.message : 'No se pudo crear la empresa.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargandoSesion || !yo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white font-mono text-sm text-neutral-500 gap-2">
        <span className="w-2 h-2 bg-black rounded-full animate-pulse inline-block" />
        Cargando sistema…
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-white blueprint-grid font-sans">

      {/* ── HEADER ── */}
      <header className="border-b-2 border-black bg-white sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 gap-4">

          {/* Logo + contexto */}
          <div className="flex items-center gap-4">
            <span className="font-mono font-black text-lg tracking-tighter bg-black text-white px-2.5 py-1 select-none">
              {'// GESTAPP'}
            </span>
            <div className="border-l-2 border-black h-8 hidden sm:block" />
            <div className="hidden sm:flex items-center gap-2 bg-brand-yellow/30 border border-brand-yellow px-2.5 py-1">
              <ShieldCheck size={14} className="text-black" />
              <span className="font-mono text-xs font-bold text-black">SUPER ADMIN</span>
            </div>
            <div className="hidden md:block">
              <h1 className="font-mono text-sm font-bold text-black">GESTIÓN DE EMPRESAS (TENANTS)</h1>
              <p className="font-mono text-[10px] text-neutral-500">Sesión: {yo.nombre}</p>
            </div>
          </div>

          {/* Acciones header */}
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/admin/usuarios"
              className="neo-btn text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <Users size={14} />
              <span className="hidden sm:inline">Usuarios</span>
            </Link>
            <button
              onClick={() => logout().then(() => router.replace('/login'))}
              className="border-2 border-black bg-brand-red text-white hover:bg-brand-red/80 font-mono font-bold text-xs px-3 py-1.5 flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none transition-all"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Cerrar sesión</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8 flex flex-col gap-6">

        {/* Métricas rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'TOTAL EMPRESAS', val: tenants.length, color: 'text-black' },
            { label: 'ACTIVAS', val: tenants.filter(t => t.status === 'active').length, color: 'text-green-700' },
            { label: 'SUSPENDIDAS', val: tenants.filter(t => t.status === 'suspended').length, color: 'text-brand-yellow' },
            { label: 'CANCELADAS', val: tenants.filter(t => t.status === 'cancelled').length, color: 'text-brand-red' },
          ].map(m => (
            <div key={m.label} className="neo-card bg-white flex flex-col p-4">
              <span className="font-mono text-[9px] text-neutral-500 font-bold tracking-widest">{m.label}</span>
              <span className={`text-2xl font-black tracking-tight mt-1 ${m.color}`}>{m.val}</span>
            </div>
          ))}
        </div>

        {/* Barra de acción */}
        <div className="flex items-center justify-between bg-white border-2 border-black p-4">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-neutral-500" />
            <span className="font-mono text-sm font-bold text-black">{tenants.length} empresa(s) registradas</span>
          </div>
          <button
            onClick={() => { setMostrarForm(v => !v); setErrorForm(null) }}
            className="neo-btn-primary text-xs py-2 px-4 flex items-center gap-1.5"
          >
            {mostrarForm ? <X size={14} /> : <Plus size={14} />}
            <span>{mostrarForm ? 'Cancelar' : 'Nueva Empresa'}</span>
          </button>
        </div>

        {/* Mensajes globales */}
        {successMsg && (
          <div className="border-2 border-black bg-brand-sage/40 p-3 flex items-center gap-2 font-mono text-xs text-green-800 font-bold">
            <CheckCircle size={16} className="text-green-700 shrink-0" />
            {successMsg}
          </div>
        )}
        {error && (
          <div className="border-2 border-black bg-brand-red/10 p-3 flex items-center gap-2 font-mono text-xs text-brand-red font-bold">
            <AlertTriangle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        {/* Formulario de creación */}
        {mostrarForm && (
          <form onSubmit={crearTenant} className="neo-card bg-white flex flex-col gap-5">
            <h2 className="font-mono text-sm font-bold border-b-2 border-black pb-3 -mx-5 px-5">
              CREAR NUEVA EMPRESA
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] text-neutral-500 font-bold tracking-widest">NOMBRE DE LA EMPRESA</span>
                <input
                  required
                  value={name}
                  onChange={(e) => onChangeName(e.target.value)}
                  className="neo-input text-sm w-full"
                  placeholder="Ej: Textiles del Caribe S.A.S."
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] text-neutral-500 font-bold tracking-widest">SLUG (SUBDOMINIO)</span>
                <input
                  required
                  value={slug}
                  onChange={(e) => { setSlugTocadoManualmente(true); setSlug(slugificar(e.target.value)) }}
                  className="neo-input text-sm font-mono w-full"
                  placeholder="textiles-del-caribe"
                />
                {slug && (
                  <span className="font-mono text-[10px] text-brand-blue font-bold">
                    → {slug}.antigravity.co
                  </span>
                )}
              </label>

              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="font-mono text-[10px] text-neutral-500 font-bold tracking-widest">PLAN DE SUSCRIPCIÓN</span>
                <div className="grid grid-cols-3 gap-3">
                  {PLANES.map(p => (
                    <button
                      type="button"
                      key={p.value}
                      onClick={() => setPlan(p.value)}
                      className={`border-2 border-black p-3 font-mono text-xs font-bold text-left transition-all ${
                        plan === p.value
                          ? 'bg-black text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,0.3)]'
                          : 'bg-white text-black hover:bg-neutral-50'
                      }`}
                    >
                      <div>{p.label.toUpperCase()}</div>
                      <div className={`text-[10px] font-normal mt-0.5 ${plan === p.value ? 'text-neutral-300' : 'text-neutral-500'}`}>
                        {p.precio}
                      </div>
                    </button>
                  ))}
                </div>
              </label>
            </div>

            {errorForm && (
              <div className="border-2 border-black bg-brand-red/10 p-3 flex items-center gap-2 font-mono text-xs text-brand-red font-bold">
                <AlertTriangle size={14} className="shrink-0" />
                {errorForm}
              </div>
            )}

            <div className="flex items-center gap-3 border-t-2 border-black pt-4 -mx-5 px-5">
              <button
                type="submit"
                disabled={enviando}
                className="neo-btn-primary text-xs py-2.5 px-5 flex items-center gap-1.5 disabled:opacity-50"
              >
                {enviando ? 'Creando empresa…' : 'Crear empresa'}
              </button>
              <button
                type="button"
                onClick={() => setMostrarForm(false)}
                className="neo-btn text-xs py-2.5 px-4"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {/* Tabla de empresas */}
        <div className="neo-card bg-white p-0 overflow-hidden">
          <div className="border-b-2 border-black bg-black text-white px-5 py-3">
            <h2 className="font-mono text-xs font-bold tracking-widest">DIRECTORIO DE EMPRESAS (TENANTS)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-black bg-neutral-100 font-mono font-bold text-black">
                  <th className="px-5 py-3">EMPRESA</th>
                  <th className="px-5 py-3">SLUG / SUBDOMINIO</th>
                  <th className="px-5 py-3">PLAN</th>
                  <th className="px-5 py-3">ESTADO</th>
                  <th className="px-5 py-3">CREADA</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {cargando ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center font-mono text-neutral-400">
                      <span className="animate-pulse">Cargando empresas…</span>
                    </td>
                  </tr>
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Building2 size={32} className="text-neutral-300" />
                        <span className="font-mono text-neutral-400 text-xs">No hay empresas todavía.</span>
                        <span className="font-mono text-neutral-400 text-[10px]">Crea la primera usando el botón &quot;Nueva Empresa&quot;.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  tenants.map((t) => (
                    <tr key={t.id} className="border-b border-neutral-200 hover:bg-neutral-50 transition-colors">
                      <td className="px-5 py-4 font-bold text-black">{t.name}</td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-[10px] bg-neutral-100 border border-neutral-300 px-1.5 py-0.5 text-neutral-600">
                          {t.slug}.antigravity.co
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-[10px] font-bold border border-black px-1.5 py-0.5 bg-white capitalize">
                          {t.plan}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 ${ESTILO_ESTADO[t.status]}`}>
                          {ETIQUETA_ESTADO[t.status]}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-neutral-500 text-[10px]">
                        {new Date(t.createdAt).toLocaleDateString('es-CO')}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button className="border border-black p-1.5 hover:bg-neutral-100 transition-colors">
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>
  )
}
