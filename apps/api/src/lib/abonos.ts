import { calcularSaldoPendiente, TIPO_DOCUMENTO_POR_TIPO_FACTURA, type Abono, type TipoFactura } from '@antigravity/shared'

/**
 * Registro de abonos, SIN control de transacción.
 *
 * El cuerpo salió tal cual de `POST /finanzas/abonos`. Se extrajo porque
 * Postgres no anida transacciones: si la ruta (que abre su propio `BEGIN`) se
 * llamara desde dentro de otra transacción, su `COMMIT` cerraría la
 * transacción externa y un `ROLLBACK` posterior no revertiría nada — se
 * escribirían medios libros. Acá la función asume que YA hay un `BEGIN` abierto
 * y deja el commit/rollback en manos de quien llama.
 *
 * Lo usan la ruta de abonos y la compra directa (que abona la CxP que ella
 * misma acaba de generar, todo en una sola transacción).
 */

export interface FilaAbono {
  id: string
  tipo_documento: string
  documento_id: string
  monto: string
  fecha: Date
  medio_pago: string | null
  referencia: string | null
  usuario_id: string | null
  created_at: Date
}

export function aAbono(row: FilaAbono): Abono {
  return {
    id: row.id,
    facturaId: row.documento_id,
    tipoDocumento: row.tipo_documento as Abono['tipoDocumento'],
    monto: Number(row.monto),
    fecha: row.fecha.toISOString().slice(0, 10),
    medioPago: row.medio_pago,
    referencia: row.referencia,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

/** Lo mínimo que necesitamos de un cliente de Postgres — lo cumplen `PoolClient` y `request.tenantDb`. */
interface ClienteSql {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>
}

export interface DatosAbono {
  tipo: TipoFactura
  facturaId: string
  monto: number
  medioPago?: string | null
  referencia?: string | null
  cuentaBancariaId?: string | null
}

export type ResultadoAbono =
  | { ok: true; fila: FilaAbono }
  /** `motivo` distingue 404 de 400 para que la ruta responda con el status correcto. */
  | { ok: false; motivo: 'no_encontrado' | 'invalido'; mensaje: string }

export async function registrarAbonoEnTx(
  client: ClienteSql,
  datos: DatosAbono,
  usuarioId: string,
): Promise<ResultadoAbono> {
  const tipoDocumento = TIPO_DOCUMENTO_POR_TIPO_FACTURA[datos.tipo]
  const tablaFactura = datos.tipo === 'cxc' ? 'facturas_venta' : 'facturas_compra'

  const facturaRes = await client.query<{ id: string; numero: string; total: string }>(
    `SELECT id, numero, total FROM ${tablaFactura} WHERE id = $1 FOR UPDATE`,
    [datos.facturaId],
  )
  if (facturaRes.rowCount === 0) {
    return { ok: false, motivo: 'no_encontrado', mensaje: 'La factura indicada no existe.' }
  }
  const factura = facturaRes.rows[0]!

  const abonosRes = await client.query<FilaAbono>(
    `SELECT id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at
     FROM abonos WHERE tipo_documento = $1 AND documento_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [tipoDocumento, factura.id],
  )
  const saldoActual = calcularSaldoPendiente(Number(factura.total), abonosRes.rows.map(aAbono))

  if (datos.monto > saldoActual) {
    return {
      ok: false,
      motivo: 'invalido',
      mensaje: `El abono ($${datos.monto.toLocaleString('es-CO')}) excede el saldo pendiente de la factura ${factura.numero} ($${saldoActual.toLocaleString('es-CO')}).`,
    }
  }

  // Si se especificó cuenta bancaria, validarla y hacer lock antes de insertar.
  if (datos.cuentaBancariaId) {
    const cuentaRes = await client.query<{ id: string; saldo: string }>(
      'SELECT id, saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [datos.cuentaBancariaId],
    )
    if (cuentaRes.rowCount === 0) {
      return { ok: false, motivo: 'invalido', mensaje: 'La cuenta bancaria seleccionada no existe.' }
    }
    if (datos.tipo === 'cxp' && Number(cuentaRes.rows[0]!.saldo) < datos.monto) {
      return {
        ok: false,
        motivo: 'invalido',
        mensaje: `Saldo insuficiente en la cuenta bancaria ($${Number(cuentaRes.rows[0]!.saldo).toLocaleString('es-CO')} disponible, se requieren $${datos.monto.toLocaleString('es-CO')}).`,
      }
    }
  }

  const { rows } = await client.query<FilaAbono>(
    `INSERT INTO abonos (tipo_documento, documento_id, monto, medio_pago, referencia, usuario_id, cuenta_bancaria_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at`,
    [tipoDocumento, factura.id, datos.monto, datos.medioPago ?? null, datos.referencia ?? null, usuarioId, datos.cuentaBancariaId ?? null],
  )

  // CxC: el dinero ENTRA → suma al saldo. CxP: el dinero SALE → resta del saldo.
  if (datos.cuentaBancariaId) {
    const operacion = datos.tipo === 'cxc' ? '+' : '-'
    await client.query(
      `UPDATE cuentas_bancarias SET saldo = saldo ${operacion} $1 WHERE id = $2`,
      [datos.monto, datos.cuentaBancariaId],
    )
  }

  return { ok: true, fila: rows[0]! }
}
