/**
 * Cadena de respaldo del cliente de IA.
 *
 * Lo que se protege acá no es "que responda": es que NUNCA conteste una
 * petición con herramientas usando un modelo que no las tiene. Ese caso
 * produce un "listo, ya lo registré" que suena perfecto y no registró nada —
 * en un CRM es la peor falla posible, porque no se nota hasta que cuadran caja.
 */
import { describe, it, expect } from 'vitest'
import { AiClient, SinCupoError, isRateLimit } from '../lib/ai/client.js'

const rateLimit = () => Object.assign(new Error('429 rate limit'), { status: 429 })
const caido = () => Object.assign(new Error('404 model not found'), { status: 404 })

const respuesta = (texto: string) => ({
  choices: [{ message: { role: 'assistant', content: texto } }],
})

/** Reemplaza los clientes internos por dobles controlados. */
function conDobles(
  client: AiClient,
  dobles: { groq1?: unknown; groq2?: unknown; gemini?: unknown },
): AiClient {
  const interno = client as unknown as Record<string, unknown>
  for (const [campo, valor] of Object.entries(dobles)) interno[campo] = valor
  return client
}

const cliente = (fn: (params: unknown) => unknown) => ({
  chat: { completions: { create: fn } },
})

const PARAMS_CON_TOOLS = {
  model: 'x',
  messages: [{ role: 'user' as const, content: 'registrá un gasto de 7900' }],
  tools: [{ type: 'function' as const, function: { name: 'registrar_gasto', parameters: {} } }],
}

const PARAMS_SIN_TOOLS = {
  model: 'x',
  messages: [{ role: 'user' as const, content: 'resumime esto' }],
}

describe('AiClient — cadena de respaldo', () => {
  it('usa el primario cuando responde', async () => {
    const c = conDobles(new AiClient('k1'), {
      groq1: cliente(() => respuesta('desde el primario')),
    })
    const r = await c.chat(PARAMS_CON_TOOLS)
    expect(r.choices[0]?.message.content).toBe('desde el primario')
  })

  it('propaga un error que no es de cupo en vez de enmascararlo', async () => {
    // Un modelo retirado tiene que verse en el log, no convertirse en una
    // respuesta degradada: así fue como se descubrió que Groq apagó llama-3.
    const c = conDobles(new AiClient('k1'), {
      groq1: cliente(() => { throw caido() }),
    })
    await expect(c.chat(PARAMS_CON_TOOLS)).rejects.toThrow('404')
  })

  it('sigue a la segunda key cuando el eslabón intermedio está caído', async () => {
    // El caso real: Gemini devolvía 404 y eso tumbaba la respuesta aunque
    // todavía quedara una alternativa viva por probar.
    const c = conDobles(new AiClient('k1', 'k2', 'gk'), {
      groq1: cliente(() => { throw rateLimit() }),
      gemini: cliente(() => { throw caido() }),
      groq2: cliente(() => respuesta('desde la segunda key')),
    })
    const r = await c.chat(PARAMS_CON_TOOLS)
    expect(r.choices[0]?.message.content).toBe('desde la segunda key')
  })

  it('NO responde con el modelo sin herramientas si la petición las traía', async () => {
    let usoElChico = false
    const c = conDobles(new AiClient('k1'), {
      groq1: cliente((p) => {
        const params = p as { tools?: unknown[] }
        if (!params.tools) { usoElChico = true; return respuesta('listo, ya lo registré') }
        throw rateLimit()
      }),
    })

    await expect(c.chat(PARAMS_CON_TOOLS)).rejects.toBeInstanceOf(SinCupoError)
    expect(usoElChico).toBe(false)
  })

  it('sí usa el modelo sin herramientas cuando la petición era solo texto', async () => {
    const c = conDobles(new AiClient('k1'), {
      groq1: cliente((p) => {
        const params = p as { tools?: unknown[] }
        if (!params.tools) return respuesta('texto mejorado')
        throw rateLimit()
      }),
    })
    const r = await c.chat(PARAMS_SIN_TOOLS)
    expect(r.choices[0]?.message.content).toContain('texto mejorado')
  })

  it('el error final cuenta qué pasó en cada eslabón', async () => {
    const c = conDobles(new AiClient('k1', 'k2', 'gk'), {
      groq1: cliente(() => { throw rateLimit() }),
      gemini: cliente(() => { throw caido() }),
      groq2: cliente(() => { throw rateLimit() }),
    })
    const err = await c.chat(PARAMS_CON_TOOLS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SinCupoError)
    expect((err as SinCupoError).fallos).toHaveLength(3)
    expect((err as SinCupoError).message).toContain('gemini')
  })

  it('quedarse sin cupo se trata como límite, no como fallo raro', async () => {
    // Define qué le decimos al dueño: "reenviá en un minuto", no "se rompió".
    expect(isRateLimit(new SinCupoError(['groq-1: sin cupo']))).toBe(true)
  })
})
