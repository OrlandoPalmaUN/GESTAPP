import type Groq from 'groq-sdk'
import { CATEGORIAS_GASTO } from '@antigravity/shared'

/**
 * Herramientas que el agente puede llamar.
 * Usar getToolsForContext() en vez de AGENT_TOOLS directamente —
 * enviar solo las tools del módulo activo reduce ~1.5k–2k tokens por request.
 *
 * REGLAS de seguridad para las write-tools:
 *  - El executor SIEMPRE valida lo que viene del LLM antes de tocar la DB.
 *  - Las transiciones de estado pasan por TRANSICIONES_VALIDAS (compartido con el handler HTTP).
 *  - Los efectos secundarios (stock, saldos, CxC/CxP) se replican aquí — el LLM
 *    no puede saltarse la atomicidad que protege a los endpoints normales.
 *  - El executor NUNCA borra. Eliminar es del usuario.
 */

const TOOLS_BY_CONTEXT: Record<string, string[]> = {
  general: [
    'buscar_cliente', 'crear_cliente', 'buscar_producto', 'crear_pedido',
    'buscar_proveedor', 'crear_proveedor', 'consultar_resumen_negocio',
    'consultar_kpis_dashboard', 'consultar_stock_bajo', 'consultar_facturas_vencidas',
    'buscar_pedido', 'crear_nota',
  ],
  pedidos: [
    'buscar_cliente', 'crear_cliente', 'buscar_producto', 'crear_pedido',
    'actualizar_estado_pedido', 'buscar_pedido', 'consultar_pedidos_pendientes',
    'ver_historial_cliente', 'registrar_abono',
  ],
  inventario: [
    'buscar_producto', 'crear_producto', 'ajustar_stock',
    'consultar_stock_bajo', 'consultar_resumen_negocio',
  ],
  clientes: [
    'buscar_cliente', 'crear_cliente', 'ver_historial_cliente',
    'registrar_abono', 'consultar_facturas_vencidas',
  ],
  // Compras dejó de ser una sección aparte: ahora se registran desde Gastos,
  // así que las herramientas de proveedor/compra viven también en finanzas.
  finanzas: [
    'buscar_cliente', 'registrar_abono', 'registrar_gasto', 'registrar_ingreso_manual',
    'ver_historial_cliente', 'consultar_resumen_negocio', 'consultar_facturas_vencidas',
    'consultar_cuentas_bancarias', 'buscar_proveedor', 'crear_proveedor',
    'buscar_producto', 'crear_compra', 'consultar_compras_pendientes',
  ],
  redes: ['consultar_posts_ig', 'consultar_metricas_ig'],
  notas: ['crear_nota', 'crear_evento_calendario'],
  proveedores: [
    'buscar_proveedor', 'crear_proveedor', 'crear_compra',
    'consultar_compras_pendientes',
  ],

  // WhatsApp no tiene pestañas: el dueño escribe lo que sea por el mismo hilo,
  // así que no se le puede recortar el set por módulo como en la web. Pero
  // tampoco caben las 26 — el plan gratis de Groq da 8.000 tokens por MINUTO y
  // cada vuelta carga el esquema completo de las herramientas. Con estas 16:
  // esquema ~2.140 + prompt ~1.290 ≈ 3.575 por vuelta → 2 vueltas por minuto,
  // que es lo que necesita una corrida (ejecutar + confirmar en palabras).
  //
  // Fuera de acá, por decisión de la dueña: las órdenes de compra. Una compra
  // a proveedor por WhatsApp se registra como un gasto y no toca inventario —
  // pedirle productos, cantidades y precios uno por uno desde el celular era
  // más trámite del que vale. Para eso está la web. Por eso tampoco están
  // buscar/crear_proveedor ni consultar_compras_pendientes.
  //
  // También fuera: Instagram y calendario (no son carga de datos por chat),
  // kpis_dashboard (lo cubre resumen_negocio) y dos consultas de solo lectura.
  whatsapp: [
    'buscar_cliente', 'crear_cliente',
    'buscar_producto', 'crear_producto', 'ajustar_stock', 'consultar_stock_bajo',
    'crear_pedido', 'actualizar_estado_pedido', 'buscar_pedido',
    'registrar_gasto', 'registrar_abono', 'registrar_ingreso_manual',
    'consultar_cuentas_bancarias', 'consultar_facturas_vencidas',
    'consultar_resumen_negocio', 'crear_nota',
  ],
  compras: [
    'buscar_proveedor', 'crear_proveedor', 'buscar_producto',
    'crear_compra', 'consultar_compras_pendientes',
  ],
}

export interface OpcionesTools {
  /**
   * Categorías de gasto activas del negocio, de `cargarCategoriasGasto`.
   * Si no se pasan, se usan los slugs de fábrica como respaldo.
   */
  categoriasGasto?: string[]
}

export function getToolsForContext(
  context: string,
  opciones: OpcionesTools = {},
): Groq.Chat.ChatCompletionTool[] {
  const names = new Set(TOOLS_BY_CONTEXT[context] ?? TOOLS_BY_CONTEXT.general)
  // Si el contexto no ofrece órdenes de compra, el esquema no puede mandar al
  // modelo a usar crear_compra: no está en la mesa.
  const hayOrdenesDeCompra = names.has('crear_compra')
  return AGENT_TOOLS
    .filter(t => t.function?.name && names.has(t.function.name))
    .map(t => cerrarCategoriaDeGasto(t, opciones.categoriasGasto, hayOrdenesDeCompra))
    .map(admitirNulosEnOpcionales)
}

/**
 * Convierte `categoria` de `registrar_gasto` en un `enum` obligatorio con las
 * categorías reales del negocio.
 *
 * Antes era un `string` libre y la lista de válidas vivía SOLO en la
 * descripción, que el modelo puede ignorar sin que Groq se queje. Pasó en
 * producción: mandó `"categoria": "kerlys"` (el nombre del proveedor), el
 * executor no la reconoció y la guardó como "otros" sin avisarle a nadie. El
 * gasto quedó bien de monto y mal de categoría, que es la peor combinación:
 * cuadra la caja y miente el reporte.
 *
 * Obligatoria y no averiguable con ninguna herramienta — de ahí que el modelo
 * tenga que preguntarla cuando el mensaje no la deja clara. Esa es la regla
 * que la acompaña en el prompt del canal.
 */
function cerrarCategoriaDeGasto(
  tool: Groq.Chat.ChatCompletionTool,
  categorias: string[] | undefined,
  hayOrdenesDeCompra: boolean,
): Groq.Chat.ChatCompletionTool {
  if (tool.function?.name !== 'registrar_gasto') return tool

  const validas = categorias?.length ? categorias : [...CATEGORIAS_GASTO]
  const params = tool.function.parameters as {
    properties: Record<string, unknown>
    required?: string[]
  }

  const mercancia = hayOrdenesDeCompra
    ? ' Para una compra de mercancía para revender NO uses un gasto: usa crear_compra, que sí entra al inventario.'
    : ''

  return {
    ...tool,
    function: {
      ...tool.function,
      parameters: {
        ...params,
        properties: {
          ...params.properties,
          categoria: {
            type: 'string',
            enum: validas,
            description:
              'Obligatoria, exactamente una de la lista. Si el mensaje no dice con claridad cuál es, preguntale al dueño antes de registrar — no elijas por él ni caigas en "otros" por descarte.' +
              mercancia,
          },
        },
        required: [...new Set([...(params.required ?? []), 'categoria'])],
      },
    },
  } as Groq.Chat.ChatCompletionTool
}

/**
 * Deja que un parámetro opcional llegue como `null` además de ausente.
 *
 * Groq valida la tool call contra este esquema ANTES de entregárnosla, y la
 * rechaza entera con un 400 si algo no encaja. Los modelos rellenan los campos
 * opcionales que no conocen con `null` en vez de omitirlos, así que un esquema
 * que solo acepta `string` convierte esa costumbre en un error duro.
 *
 * Pasó en producción con un gasto real: el modelo había resuelto todo bien
 * —la cuenta, el monto, la descripción— y la llamada murió por un
 * `"fecha": null`. El gasto no se registró y el dueño vio "no pude procesar".
 *
 * Los `null` que entren por acá los limpia `executeTool` antes de tocar SQL.
 */
function admitirNulosEnOpcionales(
  tool: Groq.Chat.ChatCompletionTool,
): Groq.Chat.ChatCompletionTool {
  const params = tool.function?.parameters as
    | { properties?: Record<string, { type?: unknown }>; required?: string[] }
    | undefined
  if (!params?.properties) return tool

  const obligatorios = new Set(params.required ?? [])
  const properties = Object.fromEntries(
    Object.entries(params.properties).map(([nombre, prop]) => {
      // Obligatorio, sin tipo declarado, o ya acepta varios: se deja igual.
      if (obligatorios.has(nombre) || typeof prop.type !== 'string') return [nombre, prop]
      return [nombre, { ...prop, type: [prop.type, 'null'] }]
    }),
  )

  return {
    ...tool,
    function: { ...tool.function, parameters: { ...params, properties } },
  } as Groq.Chat.ChatCompletionTool
}

export const AGENT_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  // ─── CLIENTES ─────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'buscar_cliente',
      description: 'Busca clientes existentes en el CRM por nombre. Úsalo SIEMPRE antes de crear un pedido o registrar un abono — necesitas el ID real.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del cliente a buscar (búsqueda parcial)' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_cliente',
      description: 'Crea un nuevo cliente. Solo si buscar_cliente devolvió vacío.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre completo o razón social' },
          email: { type: 'string', description: 'Email (opcional)' },
          telefono: { type: 'string', description: 'Teléfono (opcional)' },
          nit: { type: 'string', description: 'NIT/cédula (opcional)' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_historial_cliente',
      description: 'Historial completo de un cliente: últimos pedidos, saldo pendiente, facturas abiertas.',
      parameters: {
        type: 'object',
        properties: { cliente_id: { type: 'string', description: 'ID del cliente' } },
        required: ['cliente_id'],
      },
    },
  },

  // ─── PROVEEDORES ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'buscar_proveedor',
      description: 'Busca proveedores existentes por nombre.',
      parameters: {
        type: 'object',
        properties: { nombre: { type: 'string', description: 'Nombre del proveedor' } },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_proveedor',
      description: 'Crea un nuevo proveedor.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          email: { type: 'string' },
          telefono: { type: 'string' },
          nit: { type: 'string' },
        },
        required: ['nombre'],
      },
    },
  },

  // ─── PRODUCTOS / INVENTARIO ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'buscar_producto',
      description: 'Busca productos del inventario por nombre o descripción. Devuelve id, nombre, precio_venta, stock disponible y stock_minimo.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Texto a buscar en nombre/descripción' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_producto',
      description: 'Crea un producto. Si das stock_inicial, registra el movimiento de inventario inicial.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          precio_venta: { type: 'number' },
          precio_costo: { type: 'number' },
          stock_inicial: { type: 'number', description: 'Unidades al crear (default 0)' },
          stock_minimo: { type: 'number', description: 'Umbral para alerta de stock bajo' },
          unidad: { type: 'string', description: 'Default: unidad' },
          sku: { type: 'string' },
          descripcion: { type: 'string' },
        },
        required: ['nombre', 'precio_venta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ajustar_stock',
      description: 'Ajusta el stock de un producto (positivo = agregar, negativo = restar). Bloqueado si dejaría el stock negativo.',
      parameters: {
        type: 'object',
        properties: {
          producto_id: { type: 'string' },
          producto_nombre: { type: 'string', description: 'Para confirmar en la respuesta' },
          cantidad: { type: 'number', description: 'Siempre positiva' },
          tipo: { type: 'string', enum: ['ajuste_positivo', 'ajuste_negativo'] },
          notas: { type: 'string' },
        },
        required: ['producto_id', 'producto_nombre', 'cantidad', 'tipo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_stock_bajo',
      description: 'Lista productos cuyo stock disponible está por debajo del stock_minimo definido.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ─── PEDIDOS DE VENTA ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'crear_pedido',
      description: 'Crea un pedido de venta en estado borrador. NO confirma — el usuario debe confirmar para que descuente stock y genere CxC.',
      parameters: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string' },
          cliente_nombre: { type: 'string' },
          items: {
            type: 'array',
            description: 'Productos con id real obtenido de buscar_producto',
            items: {
              type: 'object',
              properties: {
                producto_id: { type: 'string' },
                producto_nombre: { type: 'string' },
                cantidad: { type: 'number' },
                precio_unitario: { type: 'number', description: 'Opcional — si se omite, usa precio_venta del producto' },
              },
              required: ['producto_id', 'producto_nombre', 'cantidad'],
            },
          },
          notas: { type: 'string' },
        },
        required: ['cliente_id', 'cliente_nombre', 'items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'actualizar_estado_pedido',
      description: 'Cambia el estado de un pedido. Side effects: borrador→confirmado descuenta como reserva y crea CxC si hay cliente; en_preparacion→despachado libera reserva y registra salida real; *→cancelado libera reserva. La API valida transiciones; cualquier estado puede pasar a cualquier otro distinto.',
      parameters: {
        type: 'object',
        properties: {
          pedido_id: { type: 'string' },
          nuevo_estado: {
            type: 'string',
            enum: ['borrador', 'confirmado', 'en_preparacion', 'despachado', 'entregado', 'cancelado'],
          },
          notas: { type: 'string' },
        },
        required: ['pedido_id', 'nuevo_estado'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_pedido',
      description: 'Busca un pedido por número (ej "PED-2026-0001") o por nombre de cliente.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Número o nombre de cliente' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_pedidos_pendientes',
      description: 'Lista pedidos en estados activos (borrador, confirmado, en_preparacion) que aún no se han despachado.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ─── COMPRAS (OC al proveedor) ───────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'crear_compra',
      description: 'Crea una orden de compra (OC) a un proveedor. Estado inicial: borrador. La OC suma stock solo cuando se transicione a recibido/recibido_parcial.',
      parameters: {
        type: 'object',
        properties: {
          proveedor_id: { type: 'string' },
          proveedor_nombre: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                producto_id: { type: 'string', description: 'ID real (de buscar_producto) — omite si es un concepto libre' },
                concepto: { type: 'string', description: 'Texto libre cuando no hay producto_id (ej. "Transporte")' },
                cantidad: { type: 'number' },
                precio_unitario: { type: 'number', description: 'Opcional — si se omite, usa precio_costo del producto' },
              },
              required: ['cantidad'],
            },
          },
          fecha_esperada: { type: 'string', description: 'YYYY-MM-DD (opcional)' },
          notas: { type: 'string' },
        },
        required: ['proveedor_id', 'proveedor_nombre', 'items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_compras_pendientes',
      description: 'Lista las OCs no recibidas (estados borrador, enviado, recibido_parcial).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ─── FINANZAS ─────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'registrar_abono',
      description: 'Registra un abono del cliente sobre su factura abierta más antigua. Side effect: si se especifica cuenta_bancaria_id, suma al saldo de esa cuenta. Bloqueado si monto > saldo_pendiente.',
      parameters: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string' },
          cliente_nombre: { type: 'string' },
          monto: { type: 'number', description: 'En COP' },
          // Obligatorio desde que se vio que el executor lo defaulteaba a
          // 'efectivo' en silencio: un abono cobrado por transferencia quedaba
          // registrado como efectivo y la caja dejaba de cuadrar sin que nada
          // avisara. No se puede averiguar con una herramienta — se pregunta.
          medio_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'tarjeta', 'cheque'] },
          cuenta_bancaria_id: { type: 'string', description: 'Opcional — si va a una cuenta bancaria específica' },
          referencia: { type: 'string' },
        },
        required: ['cliente_id', 'cliente_nombre', 'monto', 'medio_pago'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_gasto',
      description: 'Registra un gasto operativo. Side effect: si se especifica cuenta_bancaria_id, resta del saldo de esa cuenta.',
      parameters: {
        type: 'object',
        properties: {
          // Sin descripción, el modelo la llenaba con lo primero que tenía a
          // mano: registró "Gasto en Bancolombia" para un gasto de $2.000 en
          // kerlys, metiendo el banco (que ya va en cuenta_bancaria_id) y
          // perdiendo en qué se gastó la plata.
          descripcion: {
            type: 'string',
            description: 'En qué se gastó la plata o a quién se le pagó, en pocas palabras. NUNCA el banco ni la cuenta de donde sale: eso va aparte en cuenta_bancaria_id.',
          },
          monto: { type: 'number', description: 'En COP' },
          // La lista válida y el "obligatoria" los pone cerrarCategoriaDeGasto
          // con las categorías reales del negocio. No duplicarlas acá.
          categoria: { type: 'string' },
          cuenta_bancaria_id: { type: 'string', description: 'Opcional — descuenta del saldo' },
          fecha: { type: 'string', description: 'YYYY-MM-DD (default hoy)' },
        },
        required: ['descripcion', 'monto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_ingreso_manual',
      description: 'Registra un ingreso bancario manual (no asociado a una factura). Suma al saldo de la cuenta bancaria indicada.',
      parameters: {
        type: 'object',
        properties: {
          descripcion: { type: 'string' },
          monto: { type: 'number' },
          cuenta_bancaria_id: { type: 'string', description: 'A qué cuenta entra' },
          fecha: { type: 'string', description: 'YYYY-MM-DD (default hoy)' },
        },
        required: ['descripcion', 'monto', 'cuenta_bancaria_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_cuentas_bancarias',
      description: 'Lista las cuentas bancarias activas con sus saldos actuales.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_facturas_vencidas',
      description: 'Lista facturas de venta (CxC) y compra (CxP) cuya fecha_vencimiento ya pasó y aún tienen saldo pendiente.',
      parameters: {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['cxc', 'cxp', 'todas'],
            description: 'cxc = por cobrar, cxp = por pagar, todas = ambas (default)',
          },
        },
        required: [],
      },
    },
  },

  // ─── DASHBOARD / KPIs ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'consultar_resumen_negocio',
      description: 'Resumen general: ventas 30d, pedidos pendientes, stock crítico.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_kpis_dashboard',
      description: 'KPIs avanzados cross-módulo: top productos vendidos, top clientes por monto, OCs pendientes, pedidos sin despacho, saldo total de cuentas, CxC y CxP pendientes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ─── NOTAS / CALENDARIO ───────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'crear_nota',
      description: 'Crea una nota interna.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          contenido: { type: 'string' },
        },
        required: ['titulo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_evento_calendario',
      description: 'Crea un evento en el calendario (reunión, recordatorio, deadline).',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          tipo: { type: 'string', enum: ['reunion', 'recordatorio', 'deadline', 'otro'] },
          fecha: { type: 'string', description: 'YYYY-MM-DD' },
          descripcion: { type: 'string' },
        },
        required: ['titulo', 'fecha'],
      },
    },
  },

  // ─── INSTAGRAM ────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'consultar_posts_ig',
      description: 'Últimos posts de IG: tipo, caption, likes, comentarios, vistas, fecha. Úsalo antes de dar ideas de contenido.',
      parameters: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Cuántos posts (máx 20, default 10)' },
          tipo: {
            type: 'string',
            enum: ['VIDEO', 'CAROUSEL', 'IMAGE'],
            description: 'Filtro por tipo (opcional)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_metricas_ig',
      description: 'Métricas agregadas de IG: seguidores, engagement rate, mejores hashtags, mejores horas de publicación.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]
