import type { FastifyRequest } from 'fastify'

type TenantDb = NonNullable<FastifyRequest['tenantDb']>

/**
 * Costo efectivo de un producto: el calculado si existe, si no el manual.
 *
 * Se usa como fragmento SQL para no repetir el COALESCE en cada query y para que
 * cambiar la regla sea un solo lugar. Ver migración 029.
 */
export const COSTO_EFECTIVO_SQL = 'COALESCE(costo_promedio, precio_costo)'

/**
 * Recalcula `productos.costo_promedio` por promedio ponderado móvil al entrar
 * mercancía con un costo conocido.
 *
 *   costo_nuevo = (stock_previo × costo_previo + cantidad × costo_entrada)
 *                 / (stock_previo + cantidad)
 *
 * DEBE llamarse dentro de la misma transacción que insertó el movimiento de
 * inventario, y DESPUÉS de insertarlo: el stock previo se deriva de
 * `movimientos_inventario`, así que la fila nueva tiene que estar ahí para que el
 * cálculo cuadre — por eso se excluye explícitamente con `movimientoId`.
 *
 * Solo la llaman las entradas con costo real (`entrada_compra`,
 * `entrada_produccion`). Un `ajuste_positivo` no trae precio y un
 * `entrada_devolucion` vuelve con el costo con que salió: si recalcularan,
 * contar la nevera movería el margen sin razón.
 *
 * Si el producto no tenía costo previo, la primera entrada ES el costo (no se
 * promedia contra el `precio_costo` manual: ese es una estimación y este un dato).
 */
export async function recalcularCostoPromedio(
  db: TenantDb,
  productoId: string,
  cantidadEntrada: number,
  costoEntrada: number,
  movimientoId: string,
): Promise<void> {
  if (!Number.isFinite(costoEntrada) || costoEntrada <= 0) return
  if (!Number.isFinite(cantidadEntrada) || cantidadEntrada <= 0) return

  const { rows } = await db.query<{ costo_previo: string | null; stock_previo: string }>(
    `SELECT p.costo_promedio::text AS costo_previo,
            COALESCE((
              SELECT SUM(
                CASE WHEN m.tipo IN ('entrada_compra','entrada_devolucion','ajuste_positivo','liberacion_reserva','entrada_produccion')
                     THEN m.cantidad ELSE -m.cantidad END
              )
              FROM movimientos_inventario m
              WHERE m.producto_id = p.id AND m.id <> $2
            ), 0)::text AS stock_previo
     FROM productos p WHERE p.id = $1`,
    [productoId, movimientoId],
  )
  const fila = rows[0]
  if (!fila) return

  const costoPrevio = fila.costo_previo === null ? null : Number(fila.costo_previo)
  // Un stock previo negativo (posible si se vendió más de lo que entró) haría
  // que el ponderado diera cualquier cosa; se trata como cero.
  const stockPrevio = Math.max(0, Number(fila.stock_previo))

  const nuevo =
    costoPrevio === null || stockPrevio <= 0
      ? costoEntrada
      : (stockPrevio * costoPrevio + cantidadEntrada * costoEntrada) / (stockPrevio + cantidadEntrada)

  await db.query('UPDATE productos SET costo_promedio = ROUND($1::numeric, 2) WHERE id = $2', [nuevo, productoId])
}
