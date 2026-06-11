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
  if (biz.context === 'redes') {
    if (biz.igHandle) {
      datosIG = `\n\nInstagram del negocio: @${biz.igHandle}`
      if (biz.igSeguidores) datosIG += ` — ${biz.igSeguidores.toLocaleString('es-CO')} seguidores`
      if (biz.igTopHashtags?.length) datosIG += `\nHashtags con mejor engagement: ${biz.igTopHashtags.slice(0, 6).map(h => `#${h}`).join(' ')}`
      if (biz.igMejorHora) datosIG += `\nMejor hora para publicar: ${biz.igMejorHora}`
    }
    datosIG += `\n\nCuando el usuario pida ideas de contenido, análisis o estrategia: llama consultar_posts_ig PRIMERO para ver los posts reales y basar tus sugerencias en ellos. Luego responde con ideas concretas.`
  }

  // ── Contexto por módulo ────────────────────────────────────────────────────
  const contextos: Record<string, string> = {
    general:    'Estás en el panel general. Puedes ayudar con cualquier tema del negocio.',
    inventario: 'Estás en Inventario. Ayuda con productos, stock, ajustes y movimientos.',
    pedidos:    'Estás en Pedidos. Registra ventas, actualiza estados, consulta pedidos.',
    clientes:   'Estás en CRM. Gestiona clientes, registra pagos, consulta historial.',
    finanzas:   'Estás en Finanzas. Ayuda con flujo de caja, abonos y facturas.',
    redes:      'Estás en Redes Sociales. Tu rol principal es dar IDEAS DE CONTENIDO, analizar posts, sugerir hashtags y estrategia. Usa consultar_posts_ig para ver los posts reales antes de responder.',
    notas:      'Estás en Notas. Ayuda a escribir, organizar o crear notas.',
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
- Para CREAR o GUARDAR datos (clientes, pedidos, abonos, etc.): usa la herramienta. Nunca digas que guardaste algo sin haberlo hecho.
- Para DAR IDEAS, ANALIZAR, SUGERIR o RESPONDER preguntas: hazlo directamente — no necesitas herramienta para pensar. Si te preguntan por ideas de posts, hazlo.
- Usa las herramientas para enriquecer tus respuestas cuando haya datos relevantes (ej: ver posts antes de dar ideas).
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
