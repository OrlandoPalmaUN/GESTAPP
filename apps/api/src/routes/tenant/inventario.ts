import {
  actualizarCategoriaSchema,
  actualizarProductoSchema,
  calcularStockDisponible,
  MOVIMIENTOS_DE_ENTRADA,
  crearCategoriaSchema,
  crearMovimientoSchema,
  crearProductoSchema,
  type Categoria,
  type MovimientoInventario,
  type Producto,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface FilaProducto {
  id: string
  sku: string | null
  nombre: string
  descripcion: string | null
  categoria_id: string | null
  precio_costo: string | null
  precio_venta: string | null
  unidad: string
  stock_minimo: string
  activo: boolean
  created_at: Date
}

interface FilaMovimiento {
  id: string
  producto_id: string
  tipo: string
  cantidad: string
  precio_unitario: string | null
  referencia_tipo: string | null
  referencia_id: string | null
  notas: string | null
  usuario_id: string | null
  created_at: Date
}

function aCategoria(row: { id: string; nombre: string; created_at: Date }): Categoria {
  return { id: row.id, nombre: row.nombre, createdAt: row.created_at.toISOString() }
}

function aMovimiento(row: FilaMovimiento): MovimientoInventario {
  return {
    id: row.id,
    productoId: row.producto_id,
    tipo: row.tipo as MovimientoInventario['tipo'],
    cantidad: Number(row.cantidad),
    precioUnitario: row.precio_unitario === null ? null : Number(row.precio_unitario),
    referenciaTipo: row.referencia_tipo,
    referenciaId: row.referencia_id,
    notas: row.notas,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

function aProducto(row: FilaProducto, stockDisponible: number): Producto {
  return {
    id: row.id,
    sku: row.sku,
    nombre: row.nombre,
    descripcion: row.descripcion,
    categoriaId: row.categoria_id,
    precioCosto: row.precio_costo === null ? null : Number(row.precio_costo),
    precioVenta: row.precio_venta === null ? null : Number(row.precio_venta),
    unidad: row.unidad,
    stockMinimo: Number(row.stock_minimo),
    activo: row.activo,
    createdAt: row.created_at.toISOString(),
    stockDisponible,
  }
}

/**
 * Exige que el request ya tenga un tenant resuelto (`tenant-resolver`, ver
 * app.ts — corre como hook `onRequest` antes de cualquier ruta). Si el
 * usuario logueado no tiene `tenantId` (caso del `superadmin`, que no
 * pertenece a ninguna empresa — "sin tenant no hay usuario" es justo la
 * regla inversa: sin USUARIO-tenant no hay operación de negocio), no hay
 * schema contra el cual operar.
 */
function exigirTenant(request: FastifyRequest, reply: FastifyReply): request is FastifyRequest & {
  tenant: NonNullable<FastifyRequest['tenant']>
  tenantDb: NonNullable<FastifyRequest['tenantDb']>
} {
  if (!request.tenant || !request.tenantDb) {
    reply.badRequest(
      'Esta operación requiere una empresa (tenant) asociada a tu usuario — el superadmin no opera sobre datos de negocio.',
    )
    return false
  }
  return true
}

/**
 * Genera un SKU automático cuando el usuario no da uno — mismo esquema
 * `<prefijo>-<año>-<consecutivo>` que `generarNumeroPedido`/`generarNumeroFactura`,
 * para que crear un producto no dependa de que alguien invente una referencia.
 * El usuario sigue pudiendo escribir la suya si la necesita (p. ej. para
 * mantener consistencia con un catálogo externo).
 */
async function generarSku(tenantDb: FastifyRequest['tenantDb'] & {}): Promise<string> {
  const anio = new Date().getFullYear()
  const { rows } = await tenantDb.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM productos WHERE sku LIKE $1`,
    [`PRD-${anio}-%`],
  )
  const consecutivo = Number(rows[0]?.total ?? '0') + 1
  return `PRD-${anio}-${String(consecutivo).padStart(4, '0')}`
}

/**
 * Rutas del módulo de Inventario — operan sobre el schema del TENANT
 * (productos, categorías, movimientos), no sobre el schema público.
 *
 * Importante: usamos `request.tenantDb` (conexión dedicada con
 * `search_path` ya apuntando al schema del tenant — ver tenant-resolver) y
 * SQL parametrizado directo, NO Prisma (que no soporta `search_path`
 * dinámico) ni el pool compartido (filtraría el search_path entre tenants).
 *
 * Regla de negocio (plan §5.1): el stock NUNCA se escribe directo — toda
 * variación queda como un `movimiento_inventario` y el disponible es la
 * suma de esos movimientos (`calcularStockDisponible`, en `shared` para que
 * API y frontend nunca diverjan en el cálculo).
 */
export async function inventarioRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /inventario/categorias — solo activas (no borradas); lo borrado vive en /papelera.
  fastify.get('/inventario/categorias', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<{ id: string; nombre: string; created_at: Date }>(
      'SELECT id, nombre, created_at FROM categorias WHERE deleted_at IS NULL ORDER BY nombre ASC',
    )
    return reply.send({ categorias: rows.map(aCategoria) })
  })

  // POST /inventario/categorias
  fastify.post('/inventario/categorias', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearCategoriaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    try {
      const { rows } = await request.tenantDb.query<{ id: string; nombre: string; created_at: Date }>(
        'INSERT INTO categorias (nombre) VALUES ($1) RETURNING id, nombre, created_at',
        [body.data.nombre],
      )
      return reply.status(201).send({ categoria: aCategoria(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe una categoría llamada "${body.data.nombre}".`)
      }
      throw error
    }
  })

  // PATCH /inventario/categorias/:id — por ahora solo el nombre es editable.
  fastify.patch<{ Params: { id: string } }>('/inventario/categorias/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarCategoriaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    try {
      const { rows, rowCount } = await request.tenantDb.query<{ id: string; nombre: string; created_at: Date }>(
        'UPDATE categorias SET nombre = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id, nombre, created_at',
        [request.params.id, body.data.nombre],
      )
      if (rowCount === 0) return reply.notFound('Categoría no encontrada.')
      return reply.send({ categoria: aCategoria(rows[0]!) })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe una categoría llamada "${body.data.nombre}".`)
      }
      throw error
    }
  })

  // DELETE /inventario/categorias/:id — borrado suave, recuperable desde /papelera.
  // No se permite borrar una categoría que todavía tiene productos activos
  // colgando de ella — quedarían "huérfanos" en la práctica (el filtro de
  // inventario por categoría dejaría de encontrarlos).
  fastify.delete<{ Params: { id: string } }>('/inventario/categorias/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const enUso = await request.tenantDb.query(
      'SELECT id FROM productos WHERE categoria_id = $1 AND deleted_at IS NULL LIMIT 1',
      [request.params.id],
    )
    if ((enUso.rowCount ?? 0) > 0) {
      return reply.badRequest('No puedes eliminar esta categoría: todavía tiene productos asignados. Cámbialos de categoría primero.')
    }
    const { rowCount } = await request.tenantDb.query(
      'UPDATE categorias SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (rowCount === 0) return reply.notFound('Categoría no encontrada.')
    return reply.status(204).send()
  })

  // GET /inventario/productos — incluye el stock calculado de cada uno.
  fastify.get('/inventario/productos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const [productosRes, movimientosRes] = await Promise.all([
      request.tenantDb.query<FilaProducto>(
        'SELECT id, sku, nombre, descripcion, categoria_id, precio_costo, precio_venta, unidad, stock_minimo, activo, created_at FROM productos WHERE deleted_at IS NULL ORDER BY created_at DESC',
      ),
      request.tenantDb.query<{ producto_id: string; tipo: string; cantidad: string }>(
        'SELECT producto_id, tipo, cantidad FROM movimientos_inventario',
      ),
    ])

    const movimientosPorProducto = new Map<string, { tipo: string; cantidad: string }[]>()
    for (const mov of movimientosRes.rows) {
      const lista = movimientosPorProducto.get(mov.producto_id) ?? []
      lista.push({ tipo: mov.tipo, cantidad: mov.cantidad })
      movimientosPorProducto.set(mov.producto_id, lista)
    }

    const productos = productosRes.rows.map((row) => {
      const movimientos = (movimientosPorProducto.get(row.id) ?? []).map((m) => ({
        tipo: m.tipo as MovimientoInventario['tipo'],
        cantidad: Number(m.cantidad),
      }))
      return aProducto(row, calcularStockDisponible(movimientos))
    })

    return reply.send({ productos })
  })

  // POST /inventario/productos — crea el producto y, si trae `stockInicial`, su movimiento de ajuste inicial.
  fastify.post('/inventario/productos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearProductoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    // Capturado fuera del try para poder referenciarlo también en el catch
    // (el mensaje de conflicto debe mostrar el SKU real, generado o no).
    let sku = body.data.sku ?? null
    try {
      await client.query('BEGIN')

      if (body.data.categoriaId) {
        const cat = await client.query('SELECT id FROM categorias WHERE id = $1', [body.data.categoriaId])
        if (cat.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('La categoría seleccionada no existe.')
        }
      }

      sku = body.data.sku ?? (await generarSku(client))

      const insertProd = await client.query<FilaProducto>(
        `INSERT INTO productos (sku, nombre, descripcion, categoria_id, precio_costo, precio_venta, unidad, stock_minimo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, sku, nombre, descripcion, categoria_id, precio_costo, precio_venta, unidad, stock_minimo, activo, created_at`,
        [
          sku,
          body.data.nombre,
          body.data.descripcion ?? null,
          body.data.categoriaId ?? null,
          body.data.precioCosto ?? null,
          body.data.precioVenta ?? null,
          body.data.unidad,
          body.data.stockMinimo,
        ],
      )
      const producto = insertProd.rows[0]!

      let stockDisponible = 0
      if (body.data.stockInicial > 0) {
        await client.query(
          `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, notas)
           VALUES ($1, 'ajuste_positivo', $2, 'Inventario inicial al crear el producto')`,
          [producto.id, body.data.stockInicial],
        )
        stockDisponible = body.data.stockInicial
      }

      await client.query('COMMIT')
      return reply.status(201).send({ producto: aProducto(producto, stockDisponible) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
        return reply.conflict(`Ya existe un producto con el SKU "${sku}".`)
      }
      throw error
    }
  })

  // PATCH /inventario/productos/:id
  fastify.patch<{ Params: { id: string } }>('/inventario/productos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarProductoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      sku: body.data.sku,
      nombre: body.data.nombre,
      descripcion: body.data.descripcion,
      categoria_id: body.data.categoriaId,
      precio_costo: body.data.precioCosto,
      precio_venta: body.data.precioVenta,
      unidad: body.data.unidad,
      stock_minimo: body.data.stockMinimo,
      activo: body.data.activo,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
    const valores = entradas.map(([, v]) => v)

    const { rows, rowCount } = await request.tenantDb.query<FilaProducto>(
      `UPDATE productos SET ${sets} WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, sku, nombre, descripcion, categoria_id, precio_costo, precio_venta, unidad, stock_minimo, activo, created_at`,
      [request.params.id, ...valores],
    )
    if (rowCount === 0) return reply.notFound('Producto no encontrado.')

    const movs = await request.tenantDb.query<{ tipo: string; cantidad: string }>(
      'SELECT tipo, cantidad FROM movimientos_inventario WHERE producto_id = $1',
      [request.params.id],
    )
    const stock = calcularStockDisponible(movs.rows.map((m) => ({ tipo: m.tipo as MovimientoInventario['tipo'], cantidad: Number(m.cantidad) })))

    return reply.send({ producto: aProducto(rows[0]!, stock) })
  })

  // DELETE /inventario/productos/:id — borrado suave: el producto desaparece
  // del catálogo pero su historial de movimientos NO se toca (el principio
  // "el stock nunca se escribe directo" exige que ese rastro quede intacto
  // incluso si el producto ya no se vende). Recuperable desde /papelera.
  // Bloqueamos cuando el producto está en pedidos vivos o OCs no recibidas —
  // ?force=true permite saltarse la verificación si el usuario insiste.
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/inventario/productos/:id',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const force = request.query.force === 'true'

      if (!force) {
        const { rows } = await request.tenantDb.query<{
          pedidos_activos: number
          oc_activas: number
          stock_actual: string
        }>(
          `SELECT
             (SELECT COUNT(*) FROM pedido_items pi
              JOIN pedidos p ON p.id = pi.pedido_id
              WHERE pi.producto_id = $1 AND p.deleted_at IS NULL
                AND p.estado IN ('borrador','confirmado','en_preparacion'))::int AS pedidos_activos,
             (SELECT COUNT(*) FROM pedidos_proveedor_items ppi
              JOIN pedidos_proveedor pp ON pp.id = ppi.pedido_proveedor_id
              WHERE ppi.producto_id = $1 AND pp.deleted_at IS NULL
                AND pp.estado IN ('borrador','enviado','recibido_parcial'))::int AS oc_activas,
             COALESCE((
               SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                               THEN cantidad ELSE -cantidad END)
               FROM movimientos_inventario WHERE producto_id = $1
             ), 0)::text AS stock_actual`,
          [request.params.id],
        )
        const dep = rows[0]!
        if (dep.pedidos_activos > 0 || dep.oc_activas > 0) {
          return reply.code(409).send({
            error: 'No se puede eliminar el producto: tiene dependencias activas.',
            dependencias: {
              pedidosActivos: dep.pedidos_activos,
              ocActivas: dep.oc_activas,
              stockActual: Number(dep.stock_actual),
            },
            sugerencia: 'Despacha o cancela los pedidos y recibe las OCs primero. O agrega ?force=true para borrar de todas formas.',
          })
        }
      }

      const { rowCount } = await request.tenantDb.query(
        'UPDATE productos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [request.params.id],
      )
      if (rowCount === 0) return reply.notFound('Producto no encontrado.')
      return reply.status(204).send()
    },
  )

  // GET /inventario/stock-bajo — productos con stock disponible <= stock_minimo.
  // Endpoint dedicado para alertas y el dashboard cross-módulo.
  fastify.get('/inventario/stock-bajo', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<{
      id: string
      sku: string | null
      nombre: string
      stock_actual: string
      stock_minimo: string
      unidad: string
    }>(`
      SELECT
        p.id, p.sku, p.nombre, p.unidad,
        COALESCE((
          SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                          THEN cantidad ELSE -cantidad END)
          FROM movimientos_inventario WHERE producto_id = p.id
        ), 0)::text AS stock_actual,
        p.stock_minimo::text AS stock_minimo
      FROM productos p
      WHERE p.deleted_at IS NULL
        AND p.activo = TRUE
        AND p.stock_minimo > 0
        AND COALESCE((
          SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                          THEN cantidad ELSE -cantidad END)
          FROM movimientos_inventario WHERE producto_id = p.id
        ), 0) <= p.stock_minimo
      ORDER BY (
        COALESCE((
          SELECT SUM(CASE WHEN tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva')
                          THEN cantidad ELSE -cantidad END)
          FROM movimientos_inventario WHERE producto_id = p.id
        ), 0)::float / NULLIF(p.stock_minimo, 0)
      ) ASC
    `)
    return reply.send({
      productos: rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        nombre: r.nombre,
        unidad: r.unidad,
        stockActual: Number(r.stock_actual),
        stockMinimo: Number(r.stock_minimo),
      })),
    })
  })

  // GET /inventario/movimientos — historial transaccional, más recientes primero.
  fastify.get('/inventario/movimientos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaMovimiento>(
      `SELECT id, producto_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id, created_at
       FROM movimientos_inventario ORDER BY created_at DESC LIMIT 200`,
    )
    return reply.send({ movimientos: rows.map(aMovimiento) })
  })

  // POST /inventario/movimientos — ajustes/entradas manuales (no automáticos del ciclo de pedido).
  fastify.post('/inventario/movimientos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearMovimientoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const producto = await request.tenantDb.query('SELECT id FROM productos WHERE id = $1', [body.data.productoId])
    if (producto.rowCount === 0) return reply.badRequest('El producto indicado no existe.')

    // Regla: el stock disponible nunca puede quedar en negativo. Si el
    // movimiento RESTA (no está en MOVIMIENTOS_DE_ENTRADA), validamos contra
    // el stock actual (suma de todo el historial) antes de insertar — igual
    // que la validación que ya existe en el frontend al crear pedidos, pero
    // acá la aplicamos también a movimientos manuales (ajustes/salidas).
    if (!MOVIMIENTOS_DE_ENTRADA.includes(body.data.tipo)) {
      const movs = await request.tenantDb.query<{ tipo: string; cantidad: string }>(
        'SELECT tipo, cantidad FROM movimientos_inventario WHERE producto_id = $1',
        [body.data.productoId],
      )
      const stockActual = calcularStockDisponible(
        movs.rows.map((m) => ({ tipo: m.tipo as MovimientoInventario['tipo'], cantidad: Number(m.cantidad) })),
      )
      if (body.data.cantidad > stockActual) {
        return reply.badRequest(
          `Esta operación dejaría el stock en negativo. Disponible: ${stockActual}, solicitado: ${body.data.cantidad}.`,
        )
      }
    }

    const { rows } = await request.tenantDb.query<FilaMovimiento>(
      `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, precio_unitario, notas, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, producto_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id, created_at`,
      [body.data.productoId, body.data.tipo, body.data.cantidad, body.data.precioUnitario ?? null, body.data.notas ?? null, request.user.sub],
    )

    return reply.status(201).send({ movimiento: aMovimiento(rows[0]!) })
  })
}
