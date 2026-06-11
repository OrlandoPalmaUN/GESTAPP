'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { ShieldCheck, Lock, Mail, ArrowRight, AlertTriangle } from 'lucide-react'

import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'

export default function LoginPage() {
  const router = useRouter()
  const { usuario, cargando, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!cargando && usuario) {
      router.replace(usuario.rol === 'superadmin' ? '/admin/usuarios' : '/')
    }
  }, [cargando, usuario, router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    try {
      const u = await login(email, password)
      router.replace(u.rol === 'superadmin' ? '/admin/usuarios' : '/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="min-h-screen bg-white blueprint-grid flex flex-col items-center justify-center px-4 font-sans">

      {/* Header marca */}
      <div className="mb-8 text-center">
        <span className="font-mono font-black text-2xl tracking-tighter bg-black text-white px-3 py-1.5 select-none inline-block">
          {'// GESTAPP'}
        </span>
        <p className="font-mono text-xs text-neutral-500 mt-2 font-bold tracking-widest">
          PANEL DE ADMINISTRACIÓN · ACCESO RESTRINGIDO
        </p>
      </div>

      {/* Card principal */}
      <div className="w-full max-w-sm neo-card bg-white flex flex-col gap-0 p-0 overflow-hidden">

        {/* Franja de cabecera */}
        <div className="bg-black text-white p-5 flex items-center gap-3 border-b-2 border-black">
          <div className="border-2 border-white p-1.5">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h1 className="font-mono font-black text-base tracking-tight">INICIAR SESIÓN</h1>
            <p className="font-mono text-[10px] text-neutral-400 font-bold">Acceso administrativo de GestAPP</p>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={onSubmit} className="flex flex-col gap-5 p-6">

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] text-neutral-500 font-bold tracking-widest">CORREO ELECTRÓNICO</span>
            <div className="flex items-center border-2 border-black focus-within:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all">
              <div className="border-r-2 border-black p-2.5 bg-neutral-100">
                <Mail size={16} className="text-neutral-500" />
              </div>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1 px-3 py-2.5 text-sm font-mono bg-white outline-none text-black placeholder:text-neutral-400"
                placeholder="superadmin@gestapp.co"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] text-neutral-500 font-bold tracking-widest">CONTRASEÑA</span>
            <div className="flex items-center border-2 border-black focus-within:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all">
              <div className="border-r-2 border-black p-2.5 bg-neutral-100">
                <Lock size={16} className="text-neutral-500" />
              </div>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex-1 px-3 py-2.5 text-sm font-mono bg-white outline-none text-black placeholder:text-neutral-400"
                placeholder="••••••••"
              />
            </div>
          </label>

          {error && (
            <div className="border-2 border-black bg-brand-red/10 p-3 flex items-start gap-2" role="alert">
              <AlertTriangle size={16} className="text-brand-red shrink-0 mt-0.5" />
              <p className="font-mono text-xs text-brand-red font-bold">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="neo-btn bg-black text-white hover:bg-neutral-800 w-full flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="font-mono font-black tracking-widest">
              {enviando ? 'AUTENTICANDO...' : 'ENTRAR AL SISTEMA'}
            </span>
            {!enviando && <ArrowRight size={16} />}
          </button>
        </form>

        {/* Pie de seguridad */}
        <div className="border-t-2 border-black bg-neutral-50 px-6 py-3 flex items-center gap-2">
          <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
          <span className="font-mono text-[10px] text-neutral-500 font-bold">CONEXIÓN SEGURA · TLS 1.3</span>
        </div>
      </div>

      {/* Footer */}
      <p className="font-mono text-[10px] text-neutral-400 mt-6 text-center">
        GESTAPP © 2026 · Powered by Antigravity · v0.1.0
      </p>
    </main>
  )
}
