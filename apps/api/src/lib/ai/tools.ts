import type Groq from 'groq-sdk'

/**
 * Herramientas que el agente puede llamar.
 * Usar getToolsForContext() en vez de AGENT_TOOLS directamente —
 * enviar solo las tools del módulo activo reduce ~1.5k–2k tokens por request.
 */

// Agrupación por módulo — cada tool puede aparecer en varios contextos
const TOOLS_BY_CONTEXT: Record<string, string[]> = {
  general:    ['buscar_cliente','crear_cliente','buscar_producto','crear_pedido','buscar_proveedor','crear_proveedor','consultar_resumen_negocio','crear_nota'],
  pedidos:    ['buscar_cliente','crear_cliente','buscar_producto','crear_pedido','actualizar_estado_pedido','registrar_abono','ver_historial_cliente'],
  inventario: ['buscar_producto','crear_producto','ajustar_stock','consultar_resumen_negocio'],
  clientes:   ['buscar_cliente','crear_cliente','ver_historial_cliente','registrar_abono'],
  finanzas:   ['buscar_cliente','registrar_abono','ver_historial_cliente','consultar_resumen_negocio'],
  redes:      ['consultar_posts_ig','consultar_metricas_ig'],
  notas:      ['crear_nota'],
  proveedores:['buscar_proveedor','crear_proveedor'],
}

export function getToolsForContext(context: string): Groq.Chat.ChatCompletionTool[] {
  const names = new Set(TOOLS_BY_CONTEXT[context] ?? TOOLS_BY_CONTEXT.general)
  return AGENT_TOOLS.filter(t => t.function?.name && names.has(t.function.name))
}

export const AGENT_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'buscar_producto',
      description: 'Busca productos en el inventario del negocio por nombre o descripción.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Nombre o descripción del producto a buscar' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_cliente',
      description: 'Crea un nuevo cliente en el CRM del negocio.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre completo o razón social del cliente' },
          email: { type: 'string', description: 'Email del cliente (opcional)' },
          telefono: { type: 'string', description: 'Teléfono del cliente (opcional)' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_pedido',
      description: 'Crea un pedido de venta para un cliente existente.',
      parameters: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string', description: 'ID del cliente (obtenido de crear_cliente o buscar_cliente)' },
          cliente_nombre: { type: 'string', description: 'Nombre del cliente para confirmar' },
          items: {
            type: 'array',
            description: 'Productos del pedido',
            items: {
              type: 'object',
              properties: {
                producto_id: { type: 'string', description: 'ID del producto' },
                producto_nombre: { type: 'string', description: 'Nombre del producto' },
                cantidad: { type: 'number', description: 'Cantidad a pedir' },
                precio_unitario: { type: 'number', description: 'Precio por unidad (si se conoce)' },
              },
              required: ['producto_id', 'producto_nombre', 'cantidad'],
            },
          },
          notas: { type: 'string', description: 'Notas adicionales del pedido (opcional)' },
        },
        required: ['cliente_id', 'cliente_nombre', 'items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_cliente',
      description: 'Busca clientes existentes en el CRM por nombre.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del cliente a buscar' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_proveedor',
      description: 'Crea un nuevo proveedor en el sistema.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre o razón social del proveedor' },
          email: { type: 'string', description: 'Email del proveedor (opcional)' },
          telefono: { type: 'string', description: 'Teléfono (opcional)' },
          nit: { type: 'string', description: 'NIT o documento del proveedor (opcional)' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buscar_proveedor',
      description: 'Busca proveedores existentes por nombre.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del proveedor a buscar' },
        },
        required: ['nombre'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_resumen_negocio',
      description: 'Obtiene un resumen del estado actual del negocio: ventas recientes, stock bajo, pedidos pendientes.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_posts_ig',
      description: 'Obtiene los últimos posts de Instagram del negocio: tipo de contenido, caption, likes, comentarios, vistas y fecha. Úsalo cuando el usuario pida ideas de contenido, análisis de posts, o cualquier pregunta sobre sus publicaciones.',
      parameters: {
        type: 'object',
        properties: {
          limite: {
            type: 'number',
            description: 'Cuántos posts traer (máx 20, default 10)',
          },
          tipo: {
            type: 'string',
            enum: ['VIDEO', 'CAROUSEL', 'IMAGE'],
            description: 'Filtrar por tipo de contenido (opcional)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_producto',
      description: 'Crea un nuevo producto en el inventario.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre del producto' },
          precio_venta: { type: 'number', description: 'Precio de venta' },
          precio_costo: { type: 'number', description: 'Precio de costo (opcional)' },
          stock_inicial: { type: 'number', description: 'Unidades en stock al crearlo (default 0)' },
          stock_minimo: { type: 'number', description: 'Stock mínimo para alertas (opcional)' },
          unidad: { type: 'string', description: 'Unidad de medida (ej: unidad, kg, caja). Default: unidad' },
          sku: { type: 'string', description: 'Código SKU (opcional)' },
          descripcion: { type: 'string', description: 'Descripción del producto (opcional)' },
        },
        required: ['nombre', 'precio_venta'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ajustar_stock',
      description: 'Ajusta el stock de un producto existente. Usa ajuste_positivo para agregar unidades, ajuste_negativo para reducir.',
      parameters: {
        type: 'object',
        properties: {
          producto_id: { type: 'string', description: 'ID del producto (obtenido de buscar_producto)' },
          producto_nombre: { type: 'string', description: 'Nombre del producto para confirmar' },
          cantidad: { type: 'number', description: 'Cantidad a ajustar (siempre positiva)' },
          tipo: { type: 'string', enum: ['ajuste_positivo', 'ajuste_negativo'], description: 'Dirección del ajuste' },
          notas: { type: 'string', description: 'Motivo del ajuste (opcional)' },
        },
        required: ['producto_id', 'producto_nombre', 'cantidad', 'tipo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_abono',
      description: 'Registra un pago o abono de un cliente sobre su saldo pendiente. Busca la factura abierta y aplica el pago.',
      parameters: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string', description: 'ID del cliente' },
          cliente_nombre: { type: 'string', description: 'Nombre del cliente para confirmar' },
          monto: { type: 'number', description: 'Monto del abono en COP' },
          medio_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'tarjeta', 'cheque'], description: 'Medio de pago (default: efectivo)' },
          referencia: { type: 'string', description: 'Número de comprobante o referencia (opcional)' },
        },
        required: ['cliente_id', 'cliente_nombre', 'monto'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_nota',
      description: 'Crea una nota interna en el sistema.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Título de la nota' },
          contenido: { type: 'string', description: 'Contenido de la nota (opcional)' },
        },
        required: ['titulo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'actualizar_estado_pedido',
      description: 'Modifica o cancela el estado de un pedido existente.',
      parameters: {
        type: 'object',
        properties: {
          pedido_id: { type: 'string', description: 'ID del pedido' },
          nuevo_estado: {
            type: 'string',
            enum: ['pendiente', 'confirmado', 'en_preparacion', 'despachado', 'entregado', 'cancelado'],
            description: 'Nuevo estado del pedido',
          },
          notas: { type: 'string', description: 'Nota sobre el cambio de estado (opcional)' },
        },
        required: ['pedido_id', 'nuevo_estado'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_historial_cliente',
      description: 'Muestra el historial completo de un cliente: pedidos, saldo pendiente y últimas interacciones.',
      parameters: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string', description: 'ID del cliente' },
        },
        required: ['cliente_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_metricas_ig',
      description: 'Obtiene métricas agregadas de Instagram: seguidores, engagement rate, mejores hashtags, mejor hora para publicar y resumen de los últimos 30 días.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
]
