/**
 * Esquema de las herramientas tal como lo recibe Groq.
 *
 * Groq valida la tool call contra este esquema ANTES de entregárnosla y la
 * rechaza entera con 400 si algo no encaja. Los modelos rellenan los campos
 * opcionales que no conocen con `null`, así que un esquema que solo acepta
 * `string` convierte esa costumbre en un error duro.
 *
 * Caso real que motivó esto: un gasto de $2.000 donde el modelo ya había
 * resuelto la cuenta, el monto y la descripción, y la llamada murió por un
 * `"fecha": null`. El gasto no se registró.
 */
import { describe, it, expect } from 'vitest'
import { getToolsForContext } from '../lib/ai/tools.js'

type Props = Record<string, { type?: unknown }>

function esquemaDe(contexto: string, herramienta: string) {
  const tool = getToolsForContext(contexto).find(t => t.function?.name === herramienta)
  if (!tool) throw new Error(`no está ${herramienta} en el contexto ${contexto}`)
  const params = tool.function.parameters as { properties: Props; required?: string[] }
  return { props: params.properties, required: params.required ?? [] }
}

describe('esquema que se le manda al modelo', () => {
  it('un opcional acepta null además de su tipo', () => {
    const { props } = esquemaDe('whatsapp', 'registrar_gasto')
    expect(props.fecha?.type).toEqual(['string', 'null'])
    expect(props.cuenta_bancaria_id?.type).toEqual(['string', 'null'])
  })

  it('un obligatorio NO acepta null', () => {
    // Si `monto` admitiera null, el modelo podría mandar un gasto sin monto y
    // el error aparecería mucho más adentro, ya en SQL.
    const { props, required } = esquemaDe('whatsapp', 'registrar_gasto')
    expect(required).toContain('monto')
    expect(props.monto?.type).toBe('number')
    expect(props.descripcion?.type).toBe('string')
  })

  it('no rompe las herramientas sin parámetros', () => {
    const { props } = esquemaDe('whatsapp', 'consultar_cuentas_bancarias')
    expect(props).toEqual({})
  })

  it('vale para todos los contextos, no solo WhatsApp', () => {
    // El chat de la web pasa por el mismo camino y tiene el mismo problema.
    const { props } = esquemaDe('finanzas', 'registrar_gasto')
    expect(props.fecha?.type).toEqual(['string', 'null'])
  })

  it('ningún obligatorio de ninguna herramienta quedó aceptando null', () => {
    const contextos = ['general', 'whatsapp', 'finanzas', 'pedidos', 'inventario', 'clientes']
    for (const ctx of contextos) {
      for (const tool of getToolsForContext(ctx)) {
        const params = tool.function.parameters as { properties?: Props; required?: string[] }
        for (const nombre of params.required ?? []) {
          const tipo = params.properties?.[nombre]?.type
          expect(
            Array.isArray(tipo) && tipo.includes('null'),
            `${tool.function.name}.${nombre} es obligatorio y acepta null`,
          ).toBe(false)
        }
      }
    }
  })
})

describe('set de herramientas de WhatsApp', () => {
  it('incluye con qué registrar plata', () => {
    // La primera conversación real falló porque ninguna de estas estaba: el
    // modelo no tenía qué llamar y se inventó un trámite pidiendo IDs.
    const nombres = getToolsForContext('whatsapp').map(t => t.function?.name)
    for (const necesaria of [
      'registrar_gasto',
      'registrar_abono',
      'registrar_ingreso_manual',
      'consultar_cuentas_bancarias',
    ]) {
      expect(nombres).toContain(necesaria)
    }
  })

  it('cabe en el presupuesto de tokens del plan gratis', () => {
    // 8.000 tokens por minuto, y hacen falta DOS vueltas para que sirva: una
    // para ejecutar y otra para confirmar. Si alguien agrega herramientas sin
    // mirar esto, el canal vuelve a quedarse en una vuelta por minuto.
    const tools = getToolsForContext('whatsapp')
    const tokensAprox = Math.round(JSON.stringify(tools).length / 3.6)
    const porVuelta = tokensAprox + 1250 // system prompt + reglas de canal
    expect(porVuelta * 2).toBeLessThan(8000)
  })
})
