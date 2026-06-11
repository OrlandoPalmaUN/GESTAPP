import type Groq from 'groq-sdk'

/**
 * Herramientas que el agente puede llamar.
 * El LLM decide cuál usar según el mensaje del usuario.
 */
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
