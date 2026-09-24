/**
 * Numeración consecutiva de documentos (OC-YYYY-NNNN, FC-YYYY-NNNN).
 *
 * Vivían duplicadas: `generarNumeroOC` estaba en `routes/tenant/pedidos_proveedor.ts`
 * y otra vez en `lib/ai/executor.ts`, así que la IA y la ruta podían asignar el
 * mismo consecutivo si corrían a la par. Acá quedan en un solo lugar.
 *
 * OJO: `pg_advisory_xact_lock` es un lock de TRANSACCIÓN — solo sirve si estas
 * funciones se llaman dentro de un `BEGIN`. Fuera de una transacción el lock se
 * suelta de inmediato y dos requests simultáneas generan el mismo número.
 */

/** Lo mínimo que necesitamos de un cliente de Postgres — lo cumplen `PoolClient` y `request.tenantDb`. */
interface ClienteSql {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
}

async function siguienteConsecutivo(db: ClienteSql, llaveLock: string, tabla: string, anio: number): Promise<number> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('${llaveLock}'))`)
  const { rows } = await db.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM ${tabla} WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [anio],
  )
  return Number(rows[0]?.total ?? 0) + 1
}

/** `OC-2026-0007` — consecutivo por año sobre `pedidos_proveedor`. */
export async function generarNumeroOC(db: ClienteSql): Promise<string> {
  const anio = new Date().getFullYear()
  const n = await siguienteConsecutivo(db, 'numero_oc', 'pedidos_proveedor', anio)
  return `OC-${anio}-${String(n).padStart(4, '0')}`
}

/** `FC-2026-0007` — consecutivo por año sobre `facturas_compra`. */
export async function generarNumeroFacturaCompra(db: ClienteSql): Promise<string> {
  const anio = new Date().getFullYear()
  const n = await siguienteConsecutivo(db, 'numero_factura_compra', 'facturas_compra', anio)
  return `FC-${anio}-${String(n).padStart(4, '0')}`
}
