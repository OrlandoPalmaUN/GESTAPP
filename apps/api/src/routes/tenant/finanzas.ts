import {
  actualizarAbonoSchema,
  actualizarCuentaBancariaSchema,
  actualizarFacturaSchema,
  calcularEstadoFactura,
  calcularSaldoPendiente,
  crearAbonoSchema,
  crearCuentaBancariaSchema,
  crearFacturaSchema,
  crearGastoOperativoSchema,
  crearTransferenciaSchema,
  TIPO_DOCUMENTO_POR_TIPO_FACTURA,
  tipoFacturaSchema,
  type Abono,
  type CuentaBancaria,
  type Factura,
  type GastoOperativo,
  type CategoriaGasto,
  type TipoFactura,
  type TransferenciaBancaria,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface FilaFacturaVenta {
  id: string
  numero: string
  cliente_id: string | null
  pedido_id: string | null
  fecha_emision: Date
  fecha_vencimiento: Date
  total: string
  notas: string | null
  created_at: Date
}

interface FilaFacturaCompra {
  id: string
  numero: string
  proveedor_id: string | null
  fecha_emision: Date
  fecha_vencimiento: Date
  total: string
  notas: string | null
  created_at: Date
}

interface FilaAbono {
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

interface FilaCuentaBancaria {
  id: string
  banco: string
  numero: string
  tipo: string
  saldo: string
  created_at: Date
}

interface FilaTransferencia {
  id: string
  cuenta_origen_id: string
  cuenta_destino_id: string
  monto: string
  descripcion: string | null
  fecha: Date
  usuario_id: string | null
  created_at: Date
}

interface FilaGasto {
  id: string
  descripcion: string
  categoria: string
  monto: string
  fecha: Date
  medio_pago: string | null
  cuenta_bancaria_id: string | null
  notas: string | null
  usuario_id: string | null
  created_at: Date
}

function aCuentaBancaria(row: FilaCuentaBancaria): CuentaBancaria {
  return {
    id: row.id,
    banco: row.banco,
    numero: row.numero,
    tipo: row.tipo as CuentaBancaria['tipo'],
    saldo: Number(row.saldo),
    createdAt: row.created_at.toISOString(),
  }
}

function aAbono(row: FilaAbono): Abono {
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

function aTransferencia(row: FilaTransferencia): TransferenciaBancaria {
  return {
    id: row.id,
    cuentaOrigenId: row.cuenta_origen_id,
    cuentaDestinoId: row.cuenta_destino_id,
    monto: Number(row.monto),
    descripcion: row.descripcion,
    fecha: row.fecha.toISOString().slice(0, 10),
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

function aGasto(row: FilaGasto): GastoOperativo {
  return {
    id: row.id,
    descripcion: row.descripcion,
    categoria: row.categoria as CategoriaGasto,
    monto: Number(row.monto),
    fecha: row.fecha.toISOString().slice(0, 10),
    medioPago: row.medio_pago,
    cuentaBancariaId: row.cuenta_bancaria_id,
    notas: row.notas,
    usuarioId: row.usuario_id,
    createdAt: row.created_at.toISOString(),
  }
}

/** Forma común mínima de una fila de `facturas_venta`/`facturas_compra` — lo que `aFactura` necesita para calcular el resto. */
interface FilaFacturaBase {
  id: string
  numero: string
  fecha_emision: Date
  fecha_vencimiento: Date
  total: string
  notas: string | null
  created_at: Date
}

/** Arma una `Factura` (forma única para CxC/CxP) calculando saldo y estado a partir de sus abonos — nunca se leen de columnas guardadas. */
function aFactura(
  tipo: TipoFactura,
  row: FilaFacturaBase,
  referencias: { clienteId: string | null; proveedorId: string | null; pedidoId: string | null },
  abonos: Pick<Abono, 'monto'>[],
): Factura {
  const total = Number(row.total)
  const fechaVencimiento = row.fecha_vencimiento.toISOString().slice(0, 10)
  const saldoPendiente = calcularSaldoPendiente(total, abonos)
  return {
    id: row.id,
    numero: row.numero,
    tipo,
    clienteId: referencias.clienteId,
    proveedorId: referencias.proveedorId,
    pedidoId: referencias.pedidoId,
    fechaEmision: row.fecha_emision.toISOString().slice(0, 10),
    fechaVencimiento,
    total,
    notas: row.notas,
    saldoPendiente,
    estado: calcularEstadoFactura(saldoPendiente, fechaVencimiento),
    createdAt: row.created_at.toISOString(),
  }
}

/** Igual que en el resto de rutas de tenant — sin tenant resuelto no hay schema contra el cual operar. */
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

/** `<prefijo>-<año>-<consecutivo>` — mismo esquema que `generarNumeroPedido`, consecutivo por año y por tipo de documento. */
async function generarNumeroFactura(tenantDb: FastifyRequest['tenantDb'] & {}, tipo: TipoFactura): Promise<string> {
  const tabla = tipo === 'cxc' ? 'facturas_venta' : 'facturas_compra'
  const prefijo = tipo === 'cxc' ? 'FV' : 'FC'
  const anio = new Date().getFullYear()
  const { rows } = await tenantDb.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM ${tabla} WHERE numero LIKE $1`,
    [`${prefijo}-${anio}-%`],
  )
  const consecutivo = Number(rows[0]?.total ?? '0') + 1
  return `${prefijo}-${anio}-${String(consecutivo).padStart(4, '0')}`
}

/** Carga todos los abonos de un conjunto de facturas (de un solo tipo de documento), agrupados por `documento_id`. */
async function cargarAbonosPorFactura(
  tenantDb: FastifyRequest['tenantDb'] & {},
  tipoDocumento: 'factura_venta' | 'factura_compra',
  facturaIds: string[],
): Promise<Map<string, Abono[]>> {
  if (facturaIds.length === 0) return new Map()
  const { rows } = await tenantDb.query<FilaAbono>(
    `SELECT id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at
     FROM abonos WHERE tipo_documento = $1 AND documento_id = ANY($2::uuid[])
     ORDER BY fecha DESC, created_at DESC`,
    [tipoDocumento, facturaIds],
  )
  const porFactura = new Map<string, Abono[]>()
  for (const row of rows) {
    const abono = aAbono(row)
    const lista = porFactura.get(abono.facturaId) ?? []
    lista.push(abono)
    porFactura.set(abono.facturaId, lista)
  }
  return porFactura
}

async function listarFacturas(
  tenantDb: FastifyRequest['tenantDb'] & {},
  tipo: TipoFactura,
): Promise<Factura[]> {
  if (tipo === 'cxc') {
    const { rows } = await tenantDb.query<FilaFacturaVenta>(
      `SELECT id, numero, cliente_id, pedido_id, fecha_emision, fecha_vencimiento, total, notas, created_at
       FROM facturas_venta WHERE deleted_at IS NULL ORDER BY fecha_emision DESC, created_at DESC`,
    )
    const abonosPorFactura = await cargarAbonosPorFactura(tenantDb, 'factura_venta', rows.map((r) => r.id))
    return rows.map((row) =>
      aFactura(
        'cxc',
        row,
        { clienteId: row.cliente_id, proveedorId: null, pedidoId: row.pedido_id },
        abonosPorFactura.get(row.id) ?? [],
      ),
    )
  }

  const { rows } = await tenantDb.query<FilaFacturaCompra>(
    `SELECT id, numero, proveedor_id, fecha_emision, fecha_vencimiento, total, notas, created_at
     FROM facturas_compra WHERE deleted_at IS NULL ORDER BY fecha_emision DESC, created_at DESC`,
  )
  const abonosPorFactura = await cargarAbonosPorFactura(tenantDb, 'factura_compra', rows.map((r) => r.id))
  return rows.map((row) =>
    aFactura(
      'cxp',
      row,
      { clienteId: null, proveedorId: row.proveedor_id, pedidoId: null },
      abonosPorFactura.get(row.id) ?? [],
    ),
  )
}

/**
 * Rutas de Finanzas — facturas (CxC/CxP) y abonos. El saldo y el estado de
 * cada factura NUNCA se guardan: se derivan de `total - Σ(abonos)` y de la
 * fecha de vencimiento (mismo principio que "el stock nunca se escribe
 * directo" en Inventario — ver `calcularSaldoPendiente`/`calcularEstadoFactura`
 * en `shared`). Registrar un abono es, por tanto, la ÚNICA forma de mover el
 * saldo — y se hace transaccionalmente con un `SELECT ... FOR UPDATE` sobre la
 * factura para que dos abonos concurrentes no la sobregiren.
 */
export async function finanzasRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /finanzas/facturas?tipo=cxc|cxp
  fastify.get<{ Querystring: { tipo?: string } }>('/finanzas/facturas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const tipoParsed = tipoFacturaSchema.safeParse(request.query.tipo)
    if (!tipoParsed.success) return reply.badRequest('El parámetro "tipo" debe ser "cxc" o "cxp".')

    const facturas = await listarFacturas(request.tenantDb, tipoParsed.data)
    return reply.send({ facturas })
  })

  // POST /finanzas/facturas — registro manual (compras a proveedores, ventas de mostrador, etc.)
  fastify.post('/finanzas/facturas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearFacturaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    const { tipo } = body.data
    try {
      await client.query('BEGIN')

      if (tipo === 'cxc' && body.data.clienteId) {
        const cli = await client.query('SELECT id FROM clientes WHERE id = $1', [body.data.clienteId])
        if (cli.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('El cliente seleccionado no existe.')
        }
      }
      if (tipo === 'cxp' && body.data.proveedorId) {
        const prov = await client.query('SELECT id FROM proveedores WHERE id = $1', [body.data.proveedorId])
        if (prov.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('El proveedor seleccionado no existe.')
        }
      }

      const numero = await generarNumeroFactura(client, tipo)
      let creada: Factura
      if (tipo === 'cxc') {
        const { rows } = await client.query<FilaFacturaVenta>(
          `INSERT INTO facturas_venta (numero, cliente_id, pedido_id, fecha_vencimiento, total, notas)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, numero, cliente_id, pedido_id, fecha_emision, fecha_vencimiento, total, notas, created_at`,
          [numero, body.data.clienteId ?? null, body.data.pedidoId ?? null, body.data.fechaVencimiento, body.data.total, body.data.notas ?? null],
        )
        const row = rows[0]!
        creada = aFactura('cxc', row, { clienteId: row.cliente_id, proveedorId: null, pedidoId: row.pedido_id }, [])
      } else {
        const { rows } = await client.query<FilaFacturaCompra>(
          `INSERT INTO facturas_compra (numero, proveedor_id, fecha_vencimiento, total, notas)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, numero, proveedor_id, fecha_emision, fecha_vencimiento, total, notas, created_at`,
          [numero, body.data.proveedorId ?? null, body.data.fechaVencimiento, body.data.total, body.data.notas ?? null],
        )
        const row = rows[0]!
        creada = aFactura('cxp', row, { clienteId: null, proveedorId: row.proveedor_id, pedidoId: null }, [])
      }

      await client.query('COMMIT')
      return reply.status(201).send({ factura: creada })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // GET /finanzas/abonos — bitácora de recaudos/pagos (alimenta el resumen y el listado "últimos abonos").
  fastify.get('/finanzas/abonos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaAbono>(
      `SELECT id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at
       FROM abonos WHERE deleted_at IS NULL ORDER BY fecha DESC, created_at DESC`,
    )
    return reply.send({ abonos: rows.map(aAbono) })
  })

  // POST /finanzas/abonos — registra un abono y, transaccionalmente, recalcula
  // (vía lock) que no exceda el saldo pendiente actual de la factura.
  fastify.post('/finanzas/abonos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearAbonoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    const tipoDocumento = TIPO_DOCUMENTO_POR_TIPO_FACTURA[body.data.tipo]
    const tablaFactura = body.data.tipo === 'cxc' ? 'facturas_venta' : 'facturas_compra'

    try {
      await client.query('BEGIN')

      const facturaRes = await client.query<{ id: string; numero: string; total: string }>(
        `SELECT id, numero, total FROM ${tablaFactura} WHERE id = $1 FOR UPDATE`,
        [body.data.facturaId],
      )
      if (facturaRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return reply.notFound('La factura indicada no existe.')
      }
      const factura = facturaRes.rows[0]!

      const abonosRes = await client.query<FilaAbono>(
        `SELECT id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at
         FROM abonos WHERE tipo_documento = $1 AND documento_id = $2 FOR UPDATE`,
        [tipoDocumento, factura.id],
      )
      const saldoActual = calcularSaldoPendiente(Number(factura.total), abonosRes.rows.map(aAbono))

      if (body.data.monto > saldoActual) {
        await client.query('ROLLBACK')
        return reply.badRequest(
          `El abono ($${body.data.monto.toLocaleString('es-CO')}) excede el saldo pendiente de la factura ${factura.numero} ($${saldoActual.toLocaleString('es-CO')}).`,
        )
      }

      // Si se especificó cuenta bancaria, validarla y hacer lock antes de insertar.
      if (body.data.cuentaBancariaId) {
        const cuentaRes = await client.query<{ id: string; saldo: string }>(
          'SELECT id, saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [body.data.cuentaBancariaId],
        )
        if (cuentaRes.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('La cuenta bancaria seleccionada no existe.')
        }
      }

      const { rows } = await client.query<FilaAbono>(
        `INSERT INTO abonos (tipo_documento, documento_id, monto, medio_pago, referencia, usuario_id, cuenta_bancaria_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at`,
        [tipoDocumento, factura.id, body.data.monto, body.data.medioPago ?? null, body.data.referencia ?? null, request.user.sub, body.data.cuentaBancariaId ?? null],
      )

      // CxC: el dinero ENTRA → suma al saldo. CxP: el dinero SALE → resta del saldo.
      if (body.data.cuentaBancariaId) {
        const operacion = body.data.tipo === 'cxc' ? '+' : '-'
        await client.query(
          `UPDATE cuentas_bancarias SET saldo = saldo ${operacion} $1 WHERE id = $2`,
          [body.data.monto, body.data.cuentaBancariaId],
        )
      }

      await client.query('COMMIT')
      return reply.status(201).send({ abono: aAbono(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // PATCH /finanzas/facturas/:id?tipo=cxc|cxp — edición administrativa (ver `actualizarFacturaSchema`).
  fastify.patch<{ Params: { id: string }; Querystring: { tipo?: string } }>(
    '/finanzas/facturas/:id',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const tipoParsed = tipoFacturaSchema.safeParse(request.query.tipo)
      if (!tipoParsed.success) return reply.badRequest('El parámetro "tipo" debe ser "cxc" o "cxp".')
      const body = actualizarFacturaSchema.safeParse(request.body)
      if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
      if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

      const tabla = tipoParsed.data === 'cxc' ? 'facturas_venta' : 'facturas_compra'
      const campos: Record<string, unknown> = {
        fecha_vencimiento: body.data.fechaVencimiento,
        notas: body.data.notas,
      }
      const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
      const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
      const valores = entradas.map(([, v]) => v)

      const { rowCount } = await request.tenantDb.query(
        `UPDATE ${tabla} SET ${sets} WHERE id = $1 AND deleted_at IS NULL`,
        [request.params.id, ...valores],
      )
      if (rowCount === 0) return reply.notFound('Factura no encontrada.')

      const facturas = await listarFacturas(request.tenantDb, tipoParsed.data)
      const factura = facturas.find((f) => f.id === request.params.id)
      return reply.send({ factura })
    },
  )

  // DELETE /finanzas/facturas/:id?tipo=cxc|cxp — borrado suave, recuperable desde /papelera.
  // No se permite si la factura ya tiene abonos: borrarla "ocultaría" pagos
  // ya recibidos/hechos — primero hay que revertir esos abonos (que también son reversibles).
  fastify.delete<{ Params: { id: string }; Querystring: { tipo?: string } }>(
    '/finanzas/facturas/:id',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return
      const tipoParsed = tipoFacturaSchema.safeParse(request.query.tipo)
      if (!tipoParsed.success) return reply.badRequest('El parámetro "tipo" debe ser "cxc" o "cxp".')

      const tabla = tipoParsed.data === 'cxc' ? 'facturas_venta' : 'facturas_compra'
      const tipoDocumento = TIPO_DOCUMENTO_POR_TIPO_FACTURA[tipoParsed.data]

      const conAbonos = await request.tenantDb.query(
        'SELECT id FROM abonos WHERE tipo_documento = $1 AND documento_id = $2 AND deleted_at IS NULL LIMIT 1',
        [tipoDocumento, request.params.id],
      )
      if ((conAbonos.rowCount ?? 0) > 0) {
        return reply.badRequest('No puedes eliminar esta factura: ya tiene abonos registrados. Elimínalos primero.')
      }

      const { rowCount } = await request.tenantDb.query(
        `UPDATE ${tabla} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        [request.params.id],
      )
      if (rowCount === 0) return reply.notFound('Factura no encontrada.')
      return reply.status(204).send()
    },
  )

  // PATCH /finanzas/abonos/:id — solo metadatos (ver `actualizarAbonoSchema`); el monto no se toca por aquí.
  fastify.patch<{ Params: { id: string } }>('/finanzas/abonos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarAbonoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      medio_pago: body.data.medioPago,
      referencia: body.data.referencia,
      fecha: body.data.fecha,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
    const valores = entradas.map(([, v]) => v)

    const { rows, rowCount } = await request.tenantDb.query<FilaAbono>(
      `UPDATE abonos SET ${sets} WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, tipo_documento, documento_id, monto, fecha, medio_pago, referencia, usuario_id, created_at`,
      [request.params.id, ...valores],
    )
    if (rowCount === 0) return reply.notFound('Abono no encontrado.')
    return reply.send({ abono: aAbono(rows[0]!) })
  })

  // DELETE /finanzas/abonos/:id — borrado suave: el saldo de la factura se
  // recalcula automáticamente al excluir este abono (nunca se guarda, ver
  // `calcularSaldoPendiente`) — deshacerlo desde /papelera revierte el efecto al instante.
  fastify.delete<{ Params: { id: string } }>('/finanzas/abonos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rowCount } = await request.tenantDb.query(
      'UPDATE abonos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (rowCount === 0) return reply.notFound('Abono no encontrado.')
    return reply.status(204).send()
  })

  // --- Cuentas bancarias (antes hardcodeadas como `INITIAL_BANK_ACCOUNTS`) ---

  // GET /finanzas/cuentas
  fastify.get('/finanzas/cuentas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaCuentaBancaria>(
      'SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias WHERE deleted_at IS NULL ORDER BY created_at ASC',
    )
    return reply.send({ cuentas: rows.map(aCuentaBancaria) })
  })

  // POST /finanzas/cuentas
  fastify.post('/finanzas/cuentas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearCuentaBancariaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const { rows } = await request.tenantDb.query<FilaCuentaBancaria>(
      `INSERT INTO cuentas_bancarias (banco, numero, tipo, saldo) VALUES ($1, $2, $3, $4)
       RETURNING id, banco, numero, tipo, saldo, created_at`,
      [body.data.banco, body.data.numero, body.data.tipo, body.data.saldo ?? 0],
    )
    return reply.status(201).send({ cuenta: aCuentaBancaria(rows[0]!) })
  })

  // PATCH /finanzas/cuentas/:id
  fastify.patch<{ Params: { id: string } }>('/finanzas/cuentas/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = actualizarCuentaBancariaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No enviaste ningún campo para actualizar.')

    const campos: Record<string, unknown> = {
      banco: body.data.banco,
      numero: body.data.numero,
      tipo: body.data.tipo,
      saldo: body.data.saldo,
    }
    const entradas = Object.entries(campos).filter(([, v]) => v !== undefined)
    const sets = entradas.map(([col], idx) => `${col} = $${idx + 2}`).join(', ')
    const valores = entradas.map(([, v]) => v)

    const { rows, rowCount } = await request.tenantDb.query<FilaCuentaBancaria>(
      `UPDATE cuentas_bancarias SET ${sets} WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, banco, numero, tipo, saldo, created_at`,
      [request.params.id, ...valores],
    )
    if (rowCount === 0) return reply.notFound('Cuenta no encontrada.')
    return reply.send({ cuenta: aCuentaBancaria(rows[0]!) })
  })

  // DELETE /finanzas/cuentas/:id — borrado suave, recuperable desde /papelera.
  fastify.delete<{ Params: { id: string } }>('/finanzas/cuentas/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rowCount } = await request.tenantDb.query(
      'UPDATE cuentas_bancarias SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (rowCount === 0) return reply.notFound('Cuenta no encontrada.')
    return reply.status(204).send()
  })

  // ─── TRANSFERENCIAS BANCARIAS ─────────────────────────────────────────────

  // GET /finanzas/transferencias — historial de transferencias entre cuentas.
  fastify.get('/finanzas/transferencias', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaTransferencia>(
      `SELECT id, cuenta_origen_id, cuenta_destino_id, monto, descripcion, fecha, usuario_id, created_at
       FROM transferencias_bancarias ORDER BY created_at DESC`,
    )
    return reply.send({ transferencias: rows.map(aTransferencia) })
  })

  // POST /finanzas/transferencias — transfiere monto de una cuenta a otra
  // de forma atómica: descuenta del origen, suma al destino, registra el audit.
  fastify.post('/finanzas/transferencias', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearTransferenciaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (body.data.cuentaOrigenId === body.data.cuentaDestinoId) {
      return reply.badRequest('La cuenta de origen y la de destino deben ser distintas.')
    }

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      // Lock ambas cuentas en orden determinístico (menor id primero) para evitar deadlocks.
      const ids = [body.data.cuentaOrigenId, body.data.cuentaDestinoId].sort()
      const cuentasRes = await client.query<FilaCuentaBancaria>(
        `SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
         ORDER BY id FOR UPDATE`,
        [ids],
      )
      if (cuentasRes.rowCount !== 2) {
        await client.query('ROLLBACK')
        return reply.badRequest('Una o ambas cuentas bancarias no existen.')
      }

      const origen = cuentasRes.rows.find((c) => c.id === body.data.cuentaOrigenId)!
      if (Number(origen.saldo) < body.data.monto) {
        await client.query('ROLLBACK')
        return reply.badRequest(
          `Saldo insuficiente en la cuenta de origen ($${Number(origen.saldo).toLocaleString('es-CO')} disponible, se requieren $${body.data.monto.toLocaleString('es-CO')}).`,
        )
      }

      // Descontar del origen y sumar al destino.
      await client.query('UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2', [body.data.monto, body.data.cuentaOrigenId])
      await client.query('UPDATE cuentas_bancarias SET saldo = saldo + $1 WHERE id = $2', [body.data.monto, body.data.cuentaDestinoId])

      // Registro de auditoría.
      const { rows } = await client.query<FilaTransferencia>(
        `INSERT INTO transferencias_bancarias (cuenta_origen_id, cuenta_destino_id, monto, descripcion, fecha, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, cuenta_origen_id, cuenta_destino_id, monto, descripcion, fecha, usuario_id, created_at`,
        [
          body.data.cuentaOrigenId,
          body.data.cuentaDestinoId,
          body.data.monto,
          body.data.descripcion ?? null,
          body.data.fecha ?? new Date().toISOString().slice(0, 10),
          request.user.sub,
        ],
      )

      // Devolver también las cuentas actualizadas para que el frontend actualice el estado sin refetch.
      const cuentasActualizadasRes = await client.query<FilaCuentaBancaria>(
        'SELECT id, banco, numero, tipo, saldo, created_at FROM cuentas_bancarias WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [[body.data.cuentaOrigenId, body.data.cuentaDestinoId]],
      )

      await client.query('COMMIT')
      return reply.status(201).send({
        transferencia: aTransferencia(rows[0]!),
        cuentas: cuentasActualizadasRes.rows.map(aCuentaBancaria),
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // ─── GASTOS OPERATIVOS ────────────────────────────────────────────────────

  // GET /finanzas/gastos — listado de gastos operativos.
  fastify.get('/finanzas/gastos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaGasto>(
      `SELECT id, descripcion, categoria, monto, fecha, medio_pago, cuenta_bancaria_id, notas, usuario_id, created_at
       FROM gastos_operativos WHERE deleted_at IS NULL ORDER BY fecha DESC, created_at DESC`,
    )
    return reply.send({ gastos: rows.map(aGasto) })
  })

  // POST /finanzas/gastos — registra un gasto y, si se indicó cuenta bancaria, descuenta el monto.
  fastify.post('/finanzas/gastos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearGastoOperativoSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const client = request.tenantDb
    try {
      await client.query('BEGIN')

      if (body.data.cuentaBancariaId) {
        const cuentaRes = await client.query<{ id: string; saldo: string }>(
          'SELECT id, saldo FROM cuentas_bancarias WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [body.data.cuentaBancariaId],
        )
        if (cuentaRes.rowCount === 0) {
          await client.query('ROLLBACK')
          return reply.badRequest('La cuenta bancaria seleccionada no existe.')
        }
      }

      const fecha = body.data.fecha ?? new Date().toISOString().slice(0, 10)
      const { rows } = await client.query<FilaGasto>(
        `INSERT INTO gastos_operativos (descripcion, categoria, monto, fecha, medio_pago, cuenta_bancaria_id, notas, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, descripcion, categoria, monto, fecha, medio_pago, cuenta_bancaria_id, notas, usuario_id, created_at`,
        [
          body.data.descripcion,
          body.data.categoria,
          body.data.monto,
          fecha,
          body.data.medioPago ?? null,
          body.data.cuentaBancariaId ?? null,
          body.data.notas ?? null,
          request.user.sub,
        ],
      )

      if (body.data.cuentaBancariaId) {
        await client.query(
          'UPDATE cuentas_bancarias SET saldo = saldo - $1 WHERE id = $2',
          [body.data.monto, body.data.cuentaBancariaId],
        )
      }

      await client.query('COMMIT')
      return reply.status(201).send({ gasto: aGasto(rows[0]!) })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

  // DELETE /finanzas/gastos/:id — borrado suave.
  fastify.delete<{ Params: { id: string } }>('/finanzas/gastos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rowCount } = await request.tenantDb.query(
      'UPDATE gastos_operativos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [request.params.id],
    )
    if (rowCount === 0) return reply.notFound('Gasto no encontrado.')
    return reply.status(204).send()
  })
}
