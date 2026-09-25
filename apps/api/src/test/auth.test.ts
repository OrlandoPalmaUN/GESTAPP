/**
 * `/auth/logout` había dejado de invalidar realmente la sesión: la cookie que
 * borraba tenía `{ path: '/' }` a secas, sin el `sameSite`/`secure` con que
 * `/auth/login` la había creado. El navegador trata eso como una cookie
 * distinta y no sobreescribe la de sesión — "Cerrar sesión" respondía 200 pero
 * la cookie vieja seguía autenticando. Se detectó probando manualmente contra
 * producción: `/auth/logout` (200) seguido de `/auth/me` (200, mismo usuario).
 *
 * Este test fija el invariante sin depender de un cookie-jar de navegador:
 * compara los atributos del `Set-Cookie` de login contra los de logout.
 */
import { describe, expect, it } from 'vitest'
import { API, prepararTenant, limpiarTenant } from './apoyo.js'

const EMAIL_ADMIN = 'qa-test-admin@example.invalid'
const PASSWORD = 'QaTest1234!'

function atributo(setCookie: string, nombre: string): string | null {
  const m = new RegExp(`;\\s*${nombre}=([^;]+)`, 'i').exec(`;${setCookie}`)
  return m ? m[1]!.toLowerCase() : null
}

describe('/auth/logout borra la MISMA cookie que puso /auth/login', () => {
  it('Path/SameSite/Secure del Set-Cookie de logout coinciden con los de login', async () => {
    await prepararTenant()
    try {
      const login = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL_ADMIN, password: PASSWORD }),
      })
      const setCookieLogin = login.headers.get('set-cookie')
      expect(setCookieLogin).toBeTruthy()
      expect(setCookieLogin).toMatch(/^sesion=/)

      const logout = await fetch(`${API}/auth/logout`, { method: 'POST' })
      const setCookieLogout = logout.headers.get('set-cookie')
      expect(setCookieLogout).toBeTruthy()
      expect(setCookieLogout).toMatch(/^sesion=/)

      // Mismo Path/SameSite/Secure — si difieren, el navegador no la pisa.
      expect(atributo(setCookieLogout!, 'path')).toBe(atributo(setCookieLogin!, 'path'))
      expect(atributo(setCookieLogout!, 'samesite')).toBe(atributo(setCookieLogin!, 'samesite'))
      expect(setCookieLogout!.toLowerCase().includes('secure')).toBe(setCookieLogin!.toLowerCase().includes('secure'))

      // Y de verdad la vacía/expira — no solo copia los atributos.
      const valor = /^sesion=([^;]*)/.exec(setCookieLogout!)?.[1]
      expect(valor).toBe('')
      expect(setCookieLogout!.toLowerCase()).toMatch(/expires=thu, 01 jan 1970/)
    } finally {
      await limpiarTenant()
    }
  })
})
