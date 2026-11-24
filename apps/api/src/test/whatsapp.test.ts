/**
 * Tests del transporte de WhatsApp. A diferencia del resto de la carpeta, estos
 * NO necesitan API ni base de datos: lo que verifican es la frontera con Meta
 * —firma y forma del payload—, que es puro cómputo sobre bytes.
 *
 * Por qué justo esto y no el agente: si la firma se valida mal el endpoint
 * queda abierto (cualquiera inyecta mensajes y quema la cuota de LLM), y si el
 * payload se lee mal el agente contesta al mensaje equivocado o a un "leído".
 * Son los dos errores que no se notan mirando la app.
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { leerCambios, textoDelMensaje, validarFirmaMeta } from '../lib/whatsapp/webhook.js'

const SECRET = 'app-secret-de-prueba'

function firmar(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`
}

describe('validarFirmaMeta', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })

  it('acepta la firma correcta', () => {
    expect(validarFirmaMeta(Buffer.from(body), firmar(body), SECRET)).toBe(true)
  })

  it('acepta la firma sin el prefijo sha256=', () => {
    const hex = firmar(body).slice(7)
    expect(validarFirmaMeta(Buffer.from(body), hex, SECRET)).toBe(true)
  })

  it('rechaza un body alterado — aunque sea un espacio', () => {
    const firma = firmar(body)
    const alterado = body.replace('{"object"', '{ "object"')
    expect(validarFirmaMeta(Buffer.from(alterado), firma, SECRET)).toBe(false)
  })

  it('rechaza una firma hecha con otro secreto', () => {
    expect(validarFirmaMeta(Buffer.from(body), firmar(body, 'otro'), SECRET)).toBe(false)
  })

  it('rechaza cuando no viene el header', () => {
    expect(validarFirmaMeta(Buffer.from(body), undefined, SECRET)).toBe(false)
  })

  it('rechaza basura en el header sin lanzar', () => {
    expect(validarFirmaMeta(Buffer.from(body), 'sha256=no-es-hex', SECRET)).toBe(false)
    expect(validarFirmaMeta(Buffer.from(body), 'sha256=abcd', SECRET)).toBe(false)
  })

  it('rechaza si no hay app secret configurado', () => {
    expect(validarFirmaMeta(Buffer.from(body), firmar(body), '')).toBe(false)
  })
})

describe('leerCambios', () => {
  const mensaje = {
    id: 'wamid.abc',
    from: '573001234567',
    timestamp: '1764000000',
    type: 'text',
    text: { body: '  2 quesos costeños  ' },
  }

  it('saca el phone_number_id y los mensajes', () => {
    const cambios = leerCambios({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '12345' },
                contacts: [{ wa_id: '573001234567', profile: { name: 'Marta' } }],
                messages: [mensaje],
              },
            },
          ],
        },
      ],
    })

    expect(cambios).toHaveLength(1)
    expect(cambios[0]!.phoneNumberId).toBe('12345')
    expect(cambios[0]!.wabaId).toBe('waba-1')
    expect(cambios[0]!.mensajes[0]!.id).toBe('wamid.abc')
    expect(cambios[0]!.contactos[0]!.profile?.name).toBe('Marta')
  })

  it('ignora los avisos de entregado/leído — no son mensajes que contestar', () => {
    const cambios = leerCambios({
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '12345' },
                statuses: [{ id: 'wamid.abc', status: 'read' }],
              },
            },
          ],
        },
      ],
    })
    expect(cambios).toHaveLength(0)
  })

  it('ignora campos que no son messages', () => {
    const cambios = leerCambios({
      entry: [
        {
          changes: [
            {
              field: 'message_template_status_update',
              value: { metadata: { phone_number_id: '12345' }, messages: [mensaje] },
            },
          ],
        },
      ],
    })
    expect(cambios).toHaveLength(0)
  })

  it('descarta un cambio sin phone_number_id — sin él no hay tenant al que atribuirlo', () => {
    const cambios = leerCambios({
      entry: [{ changes: [{ field: 'messages', value: { messages: [mensaje] } }] }],
    })
    expect(cambios).toHaveLength(0)
  })

  it('devuelve un cambio por cada número, no uno por request', () => {
    const cambios = leerCambios({
      entry: [
        {
          id: 'waba-1',
          changes: [
            { field: 'messages', value: { metadata: { phone_number_id: 'A' }, messages: [mensaje] } },
          ],
        },
        {
          id: 'waba-2',
          changes: [
            { field: 'messages', value: { metadata: { phone_number_id: 'B' }, messages: [mensaje] } },
          ],
        },
      ],
    })
    expect(cambios.map((c) => c.phoneNumberId)).toEqual(['A', 'B'])
  })

  it('no explota con un payload vacío o inesperado', () => {
    expect(leerCambios(undefined)).toEqual([])
    expect(leerCambios({})).toEqual([])
    expect(leerCambios({ entry: [{}] })).toEqual([])
  })
})

describe('textoDelMensaje', () => {
  it('devuelve el texto sin espacios de más', () => {
    expect(
      textoDelMensaje({
        id: 'x',
        from: '57300',
        timestamp: '1',
        type: 'text',
        text: { body: '  hola  ' },
      }),
    ).toBe('hola')
  })

  it('devuelve null para una nota de voz — "no sé leer esto", no "vacío"', () => {
    expect(textoDelMensaje({ id: 'x', from: '57300', timestamp: '1', type: 'audio' })).toBeNull()
  })

  it('devuelve null para un texto en blanco', () => {
    expect(
      textoDelMensaje({ id: 'x', from: '57300', timestamp: '1', type: 'text', text: { body: '   ' } }),
    ).toBeNull()
  })
})

/**
 * El endpoint, sin base de datos.
 *
 * Esto verifica las cosas de Fastify que no se pueden razonar leyendo el
 * código: que el content-type parser propio de la ruta capture el body crudo
 * (si no, la firma nunca valida), que reemplazarlo no explote por estar ya
 * presente en el scope padre, y que la verificación devuelva el challenge en
 * texto plano y no como JSON.
 *
 * La instancia se arma a mano con un `prisma` de mentira en vez de usar
 * `buildApp()`: el hook `onReady` de la app real aplica migraciones contra la
 * base, y un test no tiene por qué tocar la base para probar un 401.
 */
describe('POST/GET /webhooks/whatsapp', () => {
  async function appDePrueba() {
    const Fastify = (await import('fastify')).default
    const sensible = (await import('@fastify/sensible')).default
    const { webhookWhatsappRoutes } = await import('../routes/webhook_whatsapp.js')

    const app = Fastify()
    await app.register(sensible)

    const llamadas: unknown[] = []
    app.decorate('config', {
      WHATSAPP_TOKEN: 'token',
      WHATSAPP_APP_SECRET: SECRET,
      WHATSAPP_VERIFY_TOKEN: 'verificame',
      GRAPH_API_VERSION: 'v23.0',
      GROQ_API_KEY: 'groq',
      GROQ_API_KEY_2: '',
      GOOGLE_AI_KEY: '',
    } as never)
    app.decorate('prisma', {
      tenantWhatsappNumber: {
        findFirst: async (args: unknown) => {
          llamadas.push(args)
          return null
        },
      },
    } as never)
    app.decorate('pg', {} as never)

    await app.register(webhookWhatsappRoutes)
    await app.ready()
    return { app, llamadas }
  }

  it('devuelve el hub.challenge en texto plano', async () => {
    const { app } = await appDePrueba()
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verificame&hub.challenge=1234',
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('1234')
    expect(res.headers['content-type']).toContain('text/plain')
    await app.close()
  })

  it('rechaza la verificación con el token equivocado', async () => {
    const { app } = await appDePrueba()
    const res = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1234',
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('responde 401 a un POST sin firma válida y NO procesa nada', async () => {
    const { app, llamadas } = await appDePrueba()
    const payload = JSON.stringify({ entry: [] })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
      payload,
    })
    expect(res.statusCode).toBe(401)
    expect(llamadas).toHaveLength(0)
    await app.close()
  })

  it('responde 200 a un POST firmado y encola el procesamiento', async () => {
    const { app, llamadas } = await appDePrueba()
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '12345' },
                messages: [
                  { id: 'wamid.1', from: '573001234567', timestamp: '1', type: 'text', text: { body: 'hola' } },
                ],
              },
            },
          ],
        },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': firmar(payload) },
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    // El procesamiento va en setImmediate — para cuando el 200 ya salió.
    await new Promise((r) => setImmediate(r))
    expect(llamadas).toHaveLength(1)
    await app.close()
  })

  it('no registra rutas si falta una credencial', async () => {
    const Fastify = (await import('fastify')).default
    const { webhookWhatsappRoutes } = await import('../routes/webhook_whatsapp.js')
    const app = Fastify()
    app.decorate('config', { WHATSAPP_TOKEN: '', GROQ_API_KEY: 'x' } as never)
    await app.register(webhookWhatsappRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/webhooks/whatsapp' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
