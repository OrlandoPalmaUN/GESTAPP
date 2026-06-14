import type Groq from 'groq-sdk'

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
  finanzas: [
    'buscar_cliente', 'registrar_abono', 'registrar_gasto', 'registrar_ingreso_manual',
    'ver_historial_cliente', 'consultar_resumen_negocio', 'consultar_facturas_vencidas',
    'consultar_cuentas_bancarias',
  ],
  redes: ['consultar_posts_ig', 'consultar_metricas_ig'],
  notas: ['crear_nota', 'crear_evento_calendario'],
  proveedores: [
    'buscar_proveedor', 'crear_proveedor', 'crear_compra',
    'consultar_compras_pendientes',
  ],
  compras: [
    'buscar_proveedor', 'crear_proveedor', 'buscar_producto',
    'crear_compra', 'consultar_compras_pendientes',
  ],
}

export function getToolsForContext(context: string): Groq.Chat.ChatCompletionTool[] {
  const names = new Set(TOOLS_BY_CONTEXT[context] ?? TOOLS_BY_CONTEXT.general)
  return AGENT_TOOLS.filter(t => t.function?.name && names.has(t.function.name))
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
          medio_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'tarjeta', 'cheque'] },
          cuenta_bancaria_id: { type: 'string', description: 'Opcional — si va a una cuenta bancaria específica' },
          referencia: { type: 'string' },
        },
        required: ['cliente_id', 'cliente_nombre', 'monto'],
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
          descripcion: { type: 'string' },
          monto: { type: 'number', description: 'En COP' },
          categoria: { type: 'string', description: 'Ej: nomina, servicios, transporte, materia_prima' },
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
