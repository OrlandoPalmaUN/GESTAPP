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

type Props = Record<string, { type?: unknown; enum?: string[]; description?: string }>

function esquemaDe(contexto: string, herramienta: string, opciones = {}) {
  const tool = getToolsForContext(contexto, opciones).find(t => t.function?.name === herramienta)
  const params = tool?.function?.parameters as
    | { properties: Props; required?: string[] }
    | undefined
  if (!params) throw new Error(`no está ${herramienta} en el contexto ${contexto}`)
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
        const params = tool.function?.parameters as
          | { properties?: Props; required?: string[] }
          | undefined
        for (const nombre of params?.required ?? []) {
          const tipo = params?.properties?.[nombre]?.type
          expect(
            Array.isArray(tipo) && tipo.includes('null'),
            `${tool.function?.name}.${nombre} es obligatorio y acepta null`,
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

  it('no ofrece órdenes de compra: acá una compra es un gasto', () => {
    // Decisión de la dueña: pedirle productos, cantidades y precios uno por
    // uno desde el celular era más trámite del que vale. Si crear_compra
    // estuviera en la mesa, el modelo la usaría a veces y la regla del canal
    // quedaría contradicha por el propio esquema.
    const nombres = getToolsForContext('whatsapp').map(t => t.function?.name)
    for (const fuera of [
      'crear_compra',
      'consultar_compras_pendientes',
      'buscar_proveedor',
      'crear_proveedor',
    ]) {
      expect(nombres).not.toContain(fuera)
    }
  })

  it('cabe en el presupuesto de tokens del plan gratis', () => {
    // 8.000 tokens por minuto y cada vuelta recarga el esquema entero. Medido
    // con las 16: esquema ~2.140 + prompt ~1.290 ≈ 3.575 por vuelta, o sea 2
    // vueltas por minuto — que es justo lo que necesita una corrida: una
    // vuelta para ejecutar la herramienta y otra para confirmar en palabras.
    //
    // Preguntar la categoría NO agrega una tercera vuelta: la pregunta es una
    // corrida que termina ahí (una sola vuelta, sin tool), y la respuesta de
    // la dueña arranca otra corrida nueva un minuto después. El trabajo se
    // parte en dos mensajes, no en tres vueltas seguidas.
    //
    // Sacar las 4 herramientas de órdenes de compra liberó ~460 tokens, que
    // son casi exactamente los que costaron el enum de categorías y el prompt
    // más largo. El presupuesto quedó igual que antes, no mejor.
    const tools = getToolsForContext('whatsapp')
    const tokensAprox = Math.round(JSON.stringify(tools).length / 3.6)
    const porVuelta = tokensAprox + 1400 // system prompt + reglas de canal
    expect(porVuelta * 2).toBeLessThan(8000)
  })
})

describe('categoría del gasto — lo que el dueño sí tiene que decidir', () => {
  it('es obligatoria y es un enum cerrado, no texto libre', () => {
    // El fallo real: mandó `"categoria": "kerlys"` (el proveedor). Con la
    // lista solo en la descripción, Groq no tenía con qué rechazarlo y el
    // executor lo guardó como "otros" sin avisar.
    const { props, required } = esquemaDe('whatsapp', 'registrar_gasto')
    expect(required).toContain('categoria')
    expect(props.categoria?.enum).toContain('arriendo')
    expect(props.categoria?.enum).not.toContain('kerlys')
  })

  it('usa las categorías propias del negocio, no los slugs de fábrica', () => {
    // Desde la migración 027 cada negocio edita su lista. Si acá se
    // hardcodearan los once de siempre, una categoría creada desde la web
    // sería inalcanzable por chat.
    const { props } = esquemaDe('whatsapp', 'registrar_gasto', {
      categoriasGasto: ['empaques', 'domicilios'],
    })
    expect(props.categoria?.enum).toEqual(['empaques', 'domicilios'])
  })

  it('sin categorías cargadas cae a las de fábrica, no a un enum vacío', () => {
    // Un enum vacío haría imposible registrar cualquier gasto.
    for (const opciones of [{}, { categoriasGasto: [] }]) {
      const { props } = esquemaDe('whatsapp', 'registrar_gasto', opciones)
      expect(props.categoria?.enum?.length).toBeGreaterThan(5)
      expect(props.categoria?.enum).toContain('otros')
    }
  })

  it('no manda al modelo a una herramienta que no está en la mesa', () => {
    // En finanzas crear_compra existe, así que corresponde nombrarla. En
    // WhatsApp no existe: nombrarla sería prometer algo que no puede hacer.
    expect(esquemaDe('finanzas', 'registrar_gasto').props.categoria?.description)
      .toContain('crear_compra')
    expect(esquemaDe('whatsapp', 'registrar_gasto').props.categoria?.description)
      .not.toContain('crear_compra')
  })

  it('la descripción del gasto dice qué poner y qué no', () => {
    // Estaba sin description y el modelo la llenó con el banco: guardó
    // "Gasto en Bancolombia" y se perdió en qué se gastó la plata.
    const texto = esquemaDe('whatsapp', 'registrar_gasto').props.descripcion?.description ?? ''
    expect(texto.length).toBeGreaterThan(20)
    expect(texto).toContain('cuenta_bancaria_id')
  })

  it('el medio de pago del abono es obligatorio', () => {
    // El executor lo defaulteaba a 'efectivo': un abono por transferencia
    // quedaba como efectivo y la caja dejaba de cuadrar en silencio.
    const { props, required } = esquemaDe('whatsapp', 'registrar_abono')
    expect(required).toContain('medio_pago')
    expect(props.medio_pago?.enum).toContain('transferencia')
  })
})
