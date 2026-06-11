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

  // Máximo 5 productos y 5 clientes para no inflar el prompt (rate limit)
  if (biz.topProductos?.length) {
    const lista = biz.topProductos.slice(0, 5)
      .map(p => `${p.nombre} ($${Math.round(p.precio).toLocaleString('es-CO')})`)
      .join(' | ')
    datosNegocio += `\nProductos: ${lista}`
  }

  if (biz.stockCritico?.length) {
    datosNegocio += `\n⚠ Stock crítico: ${biz.stockCritico.map(p => p.nombre).join(', ')}`
  }

  if (biz.ventasMes) {
    datosNegocio += `\nVentas mes: $${biz.ventasMes.total.toLocaleString('es-CO')} COP (${biz.ventasMes.pedidos} pedidos)`
  }

  if (biz.pedidosPendientes != null) {
    datosNegocio += ` | Pendientes: ${biz.pedidosPendientes}`
  }

  if (biz.topClientes?.length) {
    datosNegocio += `\nClientes recientes: ${biz.topClientes.slice(0, 5).map(c => c.nombre).join(', ')}`
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

## Flujo para registrar una venta — ORDEN OBLIGATORIO
Si falta nombre del cliente o nombre del producto, pregunta SOLO lo que falta. Nunca uses placeholders como "X" o "Y".

Cuando tengas nombre de cliente Y nombre(s) de producto(s):
PASO 1 → Llama buscar_cliente(nombre_cliente)
PASO 2 → Si no existe, llama crear_cliente(nombre_cliente)
PASO 3 → Para CADA producto, llama buscar_producto(nombre_producto) — OBLIGATORIO antes de crear el pedido
PASO 4 → Solo después de tener los IDs reales de los productos, llama crear_pedido(...)
PASO 5 → Confirma: cliente + productos encontrados + total en COP

REGLA CRÍTICA: NUNCA llames crear_pedido sin haber llamado buscar_producto primero para cada producto. Si buscar_producto no devuelve resultados para un producto, díselo al usuario y omite ese ítem.

## Reglas generales
- NUNCA uses "X", "Y" ni UUIDs inventados — solo IDs reales de las herramientas
- Responde en español, sin markdown
- Números en COP`
}

/** Prompt para el helper de notas — sin tools, modelo pequeño */
export function buildNotasPrompt(instruccion: string): string {
  return `Eres un asistente de redacción para notas de negocio en español.
Responde SOLO con el texto mejorado, sin explicaciones ni comentarios.
Instrucción: ${instruccion}`
}
