import { crearProduccionSchema, type Produccion, type ProduccionItem } from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import { recalcularCostoPromedio } from '../../lib/costeo.js'
import { generarNumeroProduccion } from '../../lib/numeracion.js'

interface FilaProduccion {
  id: string
  numero: string
  fecha: Date
  notas: string | null
  usuario_id: string | null
  created_at: Date
}

interface FilaProduccionItem {
  id: string
  rol: string
  producto_id: string
  variante_id: string | null
  cantidad: string
  costo_unitario: string | null
  producto_nombre?: string
}

function aItem(row: FilaProduccionItem): ProduccionItem {
  return {
    id: row.id,
    rol: row.rol as ProduccionItem['rol'],
    productoId: row.producto_id,
    varianteId: row.variante_id,
    cantidad: Number(row.cantidad),
    costoUnitario: row.costo_unitario === null ? null : Number(row.costo_unitario),
    productoNombre: row.producto_nombre,
  }
}

function aProduccion(row: FilaProduccion, items: FilaProduccionItem[]): Produccion {
  const mapeados = items.map(aItem)
  return {
    id: row.id,
    numero: row.numero,
    fecha: row.fecha.toISOString().slice(0, 10),
    notas: row.notas,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
    items: mapeados,
    costoTotal: mapeados
      .filter((i) => i.rol === 'consumo')
      .reduce((acc, i) => acc + i.cantidad * (i.costoUnitario ?? 0), 0),
  }
}

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
 * Producciones — transformar insumos en productos vendibles (migración 030).
 *
 * El caso que lo motiva: se compra un bloque de queso y al cortarlo salen N
 * libras, con desperdicio variable. Sin esto, la compra del bloque entraba
 * directo al stock de libras y el inventario mentía desde el principio.
 */
export async function produccionesRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /producciones — con sus líneas y el costo del proceso ya calculado.
  fastify.get('/producciones', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const { rows: cabeceras } = await request.tenantDb.query<FilaProduccion>(
      `SELECT id, numero, fecha, notas, usuario_id, created_at FROM producciones
       WHERE deleted_at IS NULL ORDER BY fecha DESC, created_at DESC`,
    )
    if (cabeceras.length === 0) return reply.send({ producciones: [] })

    const { rows: items } = await request.tenantDb.query<FilaProduccionItem & { produccion_id: string }>(
      `SELECT pi.id, pi.produccion_id, pi.rol, pi.producto_id, pi.variante_id, pi.cantidad,
              pi.costo_unitario, p.nombre AS producto_nombre
       FROM produccion_items pi
       JOIN productos p ON p.id = pi.producto_id
       WHERE pi.produccion_id = ANY($1::uuid[])
       ORDER BY pi.rol, pi.created_at`,
      [cabeceras.map((c) => c.id)],
    )

    const porProduccion = new Map<string, FilaProduccionItem[]>()
    for (const it of items) {
      const lista = porProduccion.get(it.produccion_id) ?? []
      lista.push(it)
      porProduccion.set(it.produccion_id, lista)
    }

    return reply.send({
      producciones: cabeceras.map((c) => aProduccion(c, porProduccion.get(c.id) ?? [])),
    })
  })

  // POST /producciones — registra la transformación completa en UNA transacción.
  //
  // El costo de lo producido se DERIVA de los insumos consumidos, nunca llega del
  // cliente: costo_total / cantidad_producida. Si hay varias salidas distintas se
  // reparte proporcional al valor de venta esperado, que es el método estándar
  // para subproductos — en el caso común (un bloque → libras de un solo
  // producto) el reparto no cambia nada.
  fastify.post('/producciones', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearProduccionSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      const idsTocados = [
        ...body.data.consumos.map((c) => c.productoId),
        ...body.data.salidas.map((s) => s.productoId),
      ]
      const { rows: productos } = await client.query<{
        id: string
        nombre: string
        es_insumo: boolean
        tiene_variantes: boolean
        costo_efectivo: string | null
        precio_venta: string | null
      }>(
        `SELECT id, nombre, es_insumo, tiene_variantes,
                COALESCE(costo_promedio, precio_costo)::text AS costo_efectivo,
                precio_venta::text
         FROM productos WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [idsTocados],
      )
      const porId = new Map(productos.map((p) => [p.id, p]))

      for (const id of idsTocados) {
        if (!porId.has(id)) {
          await client.query('ROLLBACK')
          return reply.badRequest('Uno de los productos indicados no existe.')
        }
      }

      // Un producto con variantes lleva el stock por variante, así que un
      // movimiento sin variante no le sumaría a ninguna y el stock quedaría
      // perdido en silencio — mismo criterio que la recepción de OC.
      for (const linea of [...body.data.consumos, ...body.data.salidas]) {
        const prod = porId.get(linea.productoId)!
        if (prod.tiene_variantes && !linea.varianteId) {
          await client.query('ROLLBACK')
          return reply.badRequest(`"${prod.nombre}" maneja variantes: tenés que indicar cuál.`)
        }
      }

      // Lo que salió del proceso no puede ser un insumo: un insumo se consume,
      // no se produce.
      for (const salida of body.data.salidas) {
        if (porId.get(salida.productoId)!.es_insumo) {
          await client.query('ROLLBACK')
          return reply.badRequest(
            `"${porId.get(salida.productoId)!.nombre}" está marcado como insumo, así que no puede ser el resultado de una producción.`,
          )
        }
      }

      // Costo del proceso: lo que valía cada insumo consumido.
      let costoTotal = 0
      for (const c of body.data.consumos) {
        const costo = Number(porId.get(c.productoId)!.costo_efectivo ?? 0)
        costoTotal += c.cantidad * costo
      }

      // Reparto entre las salidas. Por valor de venta relativo; si ninguna tiene
      // precio, se reparte por cantidad, que al menos es proporcional a algo.
      const valorTotalSalidas = body.data.salidas.reduce(
        (acc, s) => acc + s.cantidad * Number(porId.get(s.productoId)!.precio_venta ?? 0),
        0,
      )
      const cantidadTotalSalidas = body.data.salidas.reduce((acc, s) => acc + s.cantidad, 0)

      const numero = await generarNumeroProduccion(client)
      const fecha = body.data.fecha ?? new Date().toISOString().slice(0, 10)

      const { rows: [prod] } = await client.query<FilaProduccion>(
        `INSERT INTO producciones (numero, fecha, notas, usuario_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, numero, fecha, notas, usuario_id, created_at`,
        [numero, fecha, body.data.notas ?? null, request.user.sub],
      )

      const filasItems: FilaProduccionItem[] = []

      // ── Consumos: restan stock ───────────────────────────────────────────
      for (const c of body.data.consumos) {
        const costoUnitario = Number(porId.get(c.productoId)!.costo_efectivo ?? 0)
        const { rows: [item] } = await client.query<FilaProduccionItem>(
          `INSERT INTO produccion_items (produccion_id, rol, producto_id, variante_id, cantidad, costo_unitario)
           VALUES ($1, 'consumo', $2, $3, $4, $5)
           RETURNING id, rol, producto_id, variante_id, cantidad, costo_unitario`,
          [prod!.id, c.productoId, c.varianteId ?? null, c.cantidad, costoUnitario],
        )
        filasItems.push({ ...item!, producto_nombre: porId.get(c.productoId)!.nombre })

        await client.query(
          `INSERT INTO movimientos_inventario
             (producto_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id)
           VALUES ($1, 'consumo_produccion', $2, $3, 'produccion', $4, $5, $6)`,
          [c.productoId, c.cantidad, costoUnitario, prod!.id, `Producción ${numero}`, request.user.sub],
        )
      }

      // ── Salidas: suman stock, con el costo derivado ──────────────────────
      for (const sal of body.data.salidas) {
        const precio = Number(porId.get(sal.productoId)!.precio_venta ?? 0)
        const proporcion =
          valorTotalSalidas > 0
            ? (sal.cantidad * precio) / valorTotalSalidas
            : sal.cantidad / cantidadTotalSalidas
        const costoUnitario = sal.cantidad > 0 ? (costoTotal * proporcion) / sal.cantidad : 0

        const { rows: [item] } = await client.query<FilaProduccionItem>(
          `INSERT INTO produccion_items (produccion_id, rol, producto_id, variante_id, cantidad, costo_unitario)
           VALUES ($1, 'salida', $2, $3, $4, $5)
           RETURNING id, rol, producto_id, variante_id, cantidad, costo_unitario`,
          [prod!.id, sal.productoId, sal.varianteId ?? null, sal.cantidad, costoUnitario],
        )
        filasItems.push({ ...item!, producto_nombre: porId.get(sal.productoId)!.nombre })

        const { rows: [mov] } = await client.query<{ id: string }>(
          `INSERT INTO movimientos_inventario
             (producto_id, tipo, cantidad, precio_unitario, referencia_tipo, referencia_id, notas, usuario_id)
           VALUES ($1, 'entrada_produccion', $2, $3, 'produccion', $4, $5, $6)
           RETURNING id`,
          [sal.productoId, sal.cantidad, costoUnitario, prod!.id, `Producción ${numero}`, request.user.sub],
        )

        // El costo del producto terminado entra al promedio ponderado como
        // cualquier otra entrada con costo real (migración 029).
        await recalcularCostoPromedio(client, sal.productoId, sal.cantidad, costoUnitario, mov!.id)
      }

      await client.query('COMMIT')
      return reply.status(201).send({ produccion: aProduccion(prod!, filasItems) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}
