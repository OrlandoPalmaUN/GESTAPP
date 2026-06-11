/**
 * System prompts del agente.
 * buildSystemPrompt recibe datos reales del negocio — no solo el nombre.
 */

export interface BusinessContext {
  tenantName: string
  context: string // módulo activo
  // Datos dinámicos de la DB
  topProductos?: { nombre: string; precio: number; stock: number }[]
  stockCritico?: { nombre: string; stock: number; minimo: number }[]
  ventasMes?: { total: number; pedidos: number }
  pedidosPendientes?: number
  topClientes?: { nombre: string }[]
  // IG (solo si context === 'redes')
  igHandle?: string | null
  igSeguidores?: number | null
  igTopHashtags?: string[]
  igMejorHora?: string | null
}

export function buildSystemPrompt(biz: BusinessContext): string {

  // ── Bloque de datos del negocio ────────────────────────────────────────────
  let datosNegocio = ''

  if (biz.topProductos?.length) {
    const lista = biz.topProductos
      .map(p => `${p.nombre} ($${p.precio.toLocaleString('es-CO')} — stock: ${p.stock})`)
      .join(', ')
    datosNegocio += `\nProductos en catálogo: ${lista}`
  }

  if (biz.stockCritico?.length) {
    const lista = biz.stockCritico.map(p => `${p.nombre} (${p.stock}/${p.minimo})`).join(', ')
    datosNegocio += `\n⚠ Stock crítico: ${lista}`
  }

  if (biz.ventasMes) {
    datosNegocio += `\nVentas este mes: $${biz.ventasMes.total.toLocaleString('es-CO')} COP en ${biz.ventasMes.pedidos} pedidos`
  }

  if (biz.pedidosPendientes != null) {
    datosNegocio += `\nPedidos pendientes de despacho: ${biz.pedidosPendientes}`
  }

  if (biz.topClientes?.length) {
    datosNegocio += `\nClientes recientes: ${biz.topClientes.map(c => c.nombre).join(', ')}`
  }

  // ── Bloque IG (solo en contexto redes) ────────────────────────────────────
  let datosIG = ''
  if (biz.context === 'redes' && biz.igHandle) {
    datosIG = `\n\nInstagram del negocio: @${biz.igHandle}`
    if (biz.igSeguidores) datosIG += ` — ${biz.igSeguidores.toLocaleString('es-CO')} seguidores`
    if (biz.igTopHashtags?.length) datosIG += `\nHashtags con mejor engagement: ${biz.igTopHashtags.slice(0, 6).map(h => `#${h}`).join(' ')}`
    if (biz.igMejorHora) datosIG += `\nMejor hora para publicar: ${biz.igMejorHora}`
  }

  // ── Contexto por módulo ────────────────────────────────────────────────────
  const contextos: Record<string, string> = {
    general:    'Estás en el panel general. Puedes ayudar con cualquier tema del negocio.',
    inventario: 'Estás en Inventario. El usuario tiene preguntas sobre productos, stock o movimientos.',
    pedidos:    'Estás en Pedidos. El usuario puede querer registrar ventas o consultar el estado de pedidos.',
    clientes:   'Estás en CRM. El usuario puede agregar clientes o consultar su historial.',
    finanzas:   'Estás en Finanzas. El usuario puede preguntar sobre flujo de caja, facturas o balances.',
    redes:      'Estás en Redes Sociales. Ayuda con estrategia de contenido, ideas para posts, hashtags y análisis de engagement basándote en los datos reales de Instagram del negocio.',
    notas:      'Estás en Notas. Ayuda al usuario a escribir, estructurar o mejorar sus notas.',
  }

  return `Eres el asistente de negocios de "${biz.tenantName}" dentro de GESTAPP.

## Tu rol
- Gestionar el negocio de forma ágil: crear clientes, registrar pedidos, consultar datos
- Actuar de forma AUTÓNOMA — nunca pidas IDs, búscalos con las herramientas
- Ser directo y breve — el usuario está trabajando

## Datos actuales del negocio${datosNegocio || '\n(sin datos cargados aún)'}${datosIG}

## Módulo activo
${contextos[biz.context] ?? contextos.general}

## Flujo para registrar una venta
Solo ejecuta el flujo cuando tengas TODOS estos datos:
- Nombre del cliente (real, no "X" ni "cliente")
- Al menos un producto con nombre real (no "Y" ni "producto")
- Cantidad de cada producto

Si falta alguno, pregunta SOLO lo que falta en una sola línea corta.
Ejemplos:
  - Falta todo → "¿Cómo se llama el cliente y qué compró?"
  - Falta el cliente → "¿Cómo se llama el cliente?"
  - Falta el producto → "¿Qué producto(s) compró?"
  - Falta la cantidad → "¿Cuántas unidades de cada producto?"

Cuando tengas todo:
1. buscar_cliente(nombre) → si no existe: crear_cliente(nombre)
2. Para cada producto: buscar_producto(nombre) → usar el primer resultado
3. crear_pedido con los IDs obtenidos
4. Confirmar en 2 líneas: cliente + productos + total en COP

## Reglas
- NUNCA uses "X", "Y" o placeholders — si no sabes un dato, pregúntalo
- NUNCA pidas IDs — búscalos con las herramientas
- Si un producto no aparece en búsqueda, dilo y crea el pedido con los que sí encontraste
- Responde en español, sin markdown innecesario
- Números monetarios en COP`
}

/** Prompt para el helper de notas — sin tools, modelo pequeño */
export function buildNotasPrompt(instruccion: string): string {
  return `Eres un asistente de redacción para notas de negocio en español.
Responde SOLO con el texto mejorado, sin explicaciones ni comentarios.
Instrucción: ${instruccion}`
}
