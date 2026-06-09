'use client'

import type { RolUsuario, Tenant, Usuario } from '@antigravity/shared'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building2, LogOut, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react'

import { api, ApiError } from '../../../lib/api'
import { useAuth } from '../../../lib/auth-context'

const ROLES: { value: RolUsuario; label: string }[] = [
  { value: 'superadmin', label: 'Super admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'usuario', label: 'Usuario' },
]

const ETIQUETA_ROL: Record<RolUsuario, string> = {
  superadmin: 'Super admin',
  admin: 'Admin',
  usuario: 'Usuario',
}

const ESTILO_ROL: Record<RolUsuario, string> = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  usuario: 'bg-neutral-100 text-neutral-700',
}

export default function AdminUsuariosPage() {
  const router = useRouter()
  const { usuario: yo, cargando: cargandoSesion, logout } = useAuth()

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form de creación
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState<RolUsuario>('usuario')
  const [tenantId, setTenantId] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorForm, setErrorForm] = useState<string | null>(null)

  // Regla de negocio: "sin tenant no hay usuario" — solo el superadmin no
  // necesita pertenecer a una empresa.
  const requiereTenant = rol !== 'superadmin'
  const tenantsPorId = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants])

  // Scoping: un `admin` de tenant no puede crear superadmins ni elegir otra
  // empresa — queda fijo a la suya. Solo el superadmin ve el rol "Super admin"
  // y el selector de empresa con todas las opciones.
  const rolesDisponibles = yo?.rol === 'superadmin' ? ROLES : ROLES.filter((r) => r.value !== 'superadmin')
  const tenantFijo = yo?.rol === 'admin' ? yo.tenantId : null

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [{ usuarios }, tenantsRes] = await Promise.all([
        api.listarUsuarios(),
        // Un `admin` de tenant no tiene permiso para listar empresas (solo
        // el superadmin) — si falla, seguimos sin el selector de tenant.
        api.listarTenants().catch(() => ({ tenants: [] as Tenant[] })),
      ])
      setUsuarios(usuarios)
      setTenants(tenantsRes.tenants)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cargar la lista de usuarios.')
    } finally {
      setCargando(false)
    }
  }, [])

  // Guard de ruta: sin sesión → /login. Con sesión pero sin permisos → fuera.
  useEffect(() => {
    if (cargandoSesion) return
    if (!yo) {
      router.replace('/login')
      return
    }
    if (yo.rol !== 'superadmin' && yo.rol !== 'admin') {
      router.replace('/')
      return
    }
    void cargar()
  }, [cargandoSesion, yo, router, cargar])

  async function crearUsuario(e: FormEvent) {
    e.preventDefault()
    setErrorForm(null)

    if (requiereTenant && !tenantFijo && !tenantId) {
      setErrorForm('Selecciona la empresa a la que pertenece este usuario — sin tenant no hay usuario.')
      return
    }

    const tenantIdEnvio = requiereTenant ? (tenantFijo ?? tenantId) : null

    setEnviando(true)
    try {
      await api.crearUsuario({ email, password, nombre, rol, tenantId: tenantIdEnvio })
      setNombre('')
      setEmail('')
      setPassword('')
      setRol('usuario')
      setTenantId('')
      setMostrarForm(false)
      await cargar()
    } catch (err) {
      setErrorForm(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.')
    } finally {
      setEnviando(false)
    }
  }

  async function eliminarUsuario(u: Usuario) {
    if (!confirm(`¿Eliminar a ${u.nombre} (${u.email})? Esta acción no se puede deshacer.`)) return
    try {
      await api.eliminarUsuario(u.id)
      await cargar()
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'No se pudo eliminar el usuario.')
    }
  }

  async function cambiarEstado(u: Usuario) {
    const nuevoEstado = u.status === 'active' ? 'suspended' : 'active'
    try {
      await api.actualizarUsuario(u.id, { status: nuevoEstado })
      await cargar()
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'No se pudo actualizar el usuario.')
    }
  }

  if (cargandoSesion || !yo) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">Cargando…</div>
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h1 className="text-base font-semibold text-neutral-900">Administración de usuarios</h1>
              <p className="text-xs text-neutral-500">
                Sesión: {yo.nombre} · <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTILO_ROL[yo.rol]}`}>{ETIQUETA_ROL[yo.rol]}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {yo.rol === 'superadmin' && (
              <Link
                href="/admin/empresas"
                className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
              >
                <Building2 size={15} /> Empresas
              </Link>
            )}
            <button
              onClick={() => logout().then(() => router.replace('/login'))}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100"
            >
              <LogOut size={15} /> Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCog size={18} className="text-neutral-400" />
            <h2 className="text-sm font-medium text-neutral-700">{usuarios.length} usuario(s)</h2>
          </div>
          <button
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            <Plus size={15} /> Nuevo usuario
          </button>
        </div>

        {mostrarForm && (
          <form onSubmit={crearUsuario} className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-neutral-200 bg-white p-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-neutral-700">Nombre</span>
              <input
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-neutral-700">Correo</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-neutral-700">Contraseña</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                placeholder="Mínimo 8 caracteres"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-neutral-700">Rol</span>
              <select
                value={rol}
                onChange={(e) => setRol(e.target.value as RolUsuario)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
              >
                {rolesDisponibles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            {requiereTenant && tenantFijo && (
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-neutral-700">Empresa (tenant)</span>
                <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                  {tenantsPorId.get(tenantFijo)?.name ?? 'Tu empresa'}{' '}
                  <span className="text-neutral-400">— como admin, solo puedes crear usuarios dentro de tu propia empresa</span>
                </p>
              </label>
            )}

            {requiereTenant && !tenantFijo && (
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-neutral-700">
                  Empresa (tenant) <span className="font-normal text-neutral-400">— sin tenant no hay usuario</span>
                </span>
                {tenants.length === 0 ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    No hay empresas creadas todavía.{' '}
                    <Link href="/admin/empresas" className="font-medium underline">
                      Crea una primero
                    </Link>{' '}
                    para poder asignarle usuarios.
                  </p>
                ) : (
                  <select
                    required
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                  >
                    <option value="" disabled>
                      Selecciona una empresa…
                    </option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.slug})
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}

            {errorForm && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2" role="alert">
                {errorForm}
              </p>
            )}

            <div className="flex items-center gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={enviando}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                {enviando ? 'Creando…' : 'Crear usuario'}
              </button>
              <button
                type="button"
                onClick={() => setMostrarForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Correo</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Último acceso</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                    Cargando usuarios…
                  </td>
                </tr>
              ) : usuarios.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                    No hay usuarios todavía.
                  </td>
                </tr>
              ) : (
                usuarios.map((u) => (
                  <tr key={u.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-neutral-900">{u.nombre}</td>
                    <td className="px-4 py-3 text-neutral-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTILO_ROL[u.rol]}`}>{ETIQUETA_ROL[u.rol]}</span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {u.tenantId ? (tenantsPorId.get(u.tenantId)?.name ?? <span className="text-neutral-400">(empresa no encontrada)</span>) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => cambiarEstado(u)}
                        disabled={u.id === yo.id}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          u.status === 'active' ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300'
                        }`}
                        title={u.id === yo.id ? 'No puedes cambiar tu propio estado' : 'Cambiar estado'}
                      >
                        {u.status === 'active' ? 'Activo' : 'Suspendido'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('es-CO') : 'Nunca'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => eliminarUsuario(u)}
                        disabled={u.id === yo.id}
                        className="rounded p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                        title={u.id === yo.id ? 'No puedes eliminar tu propio usuario' : 'Eliminar usuario'}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
