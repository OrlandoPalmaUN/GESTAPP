'use client'

import type { PlanId, Tenant, Usuario } from '@antigravity/shared'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

import { api, saveToken, clearToken } from './api'

/** Info mínima del tenant del usuario logueado — la resuelve `tenant-resolver` en la API y viaja en `/auth/me`. */
export type TenantDeSesion = Pick<Tenant, 'id' | 'name' | 'slug' | 'status'> & { plan: PlanId }

interface AuthContextValue {
  usuario: Usuario | null
  /** `null` para el superadmin (no pertenece a ninguna empresa) o mientras carga. */
  tenant: TenantDeSesion | null
  /** `true` mientras se intenta hidratar la sesión desde la cookie al cargar. */
  cargando: boolean
  login: (email: string, password: string) => Promise<Usuario>
  logout: () => Promise<void>
  /** Autoservicio: el propio usuario edita su personalización de UI (p. ej. `colorSecundario`). */
  actualizarPerfil: (data: { colorSecundario: string | null }) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [tenant, setTenant] = useState<TenantDeSesion | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    api
      .me()
      .then(({ usuario, tenant }) => {
        setUsuario(usuario)
        setTenant(tenant ?? null)
      })
      .catch(() => {
        setUsuario(null)
        setTenant(null)
      })
      .finally(() => setCargando(false))
  }, [])

  const login = useCallback(async (email: string, password: string): Promise<Usuario> => {
    const { usuario, token } = await api.login(email, password)
    saveToken(token) // persiste para iOS Safari (ITP bloquea cookies cross-origin)
    setUsuario(usuario)
    // El login no trae el tenant — lo hidratamos con `/auth/me` justo después.
    try {
      const { tenant } = await api.me()
      setTenant(tenant ?? null)
    } catch {
      setTenant(null)
    }
    return usuario
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined)
    clearToken()
    setUsuario(null)
    setTenant(null)
  }, [])

  const actualizarPerfil = useCallback(async (data: { colorSecundario: string | null }) => {
    const { usuario } = await api.actualizarPerfil(data)
    setUsuario(usuario)
  }, [])

  return (
    <AuthContext.Provider value={{ usuario, tenant, cargando, login, logout, actualizarPerfil }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
