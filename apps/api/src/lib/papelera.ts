import type { FastifyRequest } from 'fastify'

/**
 * "Papelera" / deshacer — genérico para todos los módulos operativos.
 *
 * Decisión de diseño (igual espíritu que "el stock nunca se escribe
 * directo"): nada se borra directo. Cada DELETE de la API es en realidad un
 * `UPDATE ... SET deleted_at = NOW()`, así que toda fila borrada queda
 * recuperable. Esta tabla central de metadatos por entidad es lo único que
 * hace falta para poder LISTAR y RESTAURAR desde un solo lugar — el borrado
 * real vive en cada ruta (porque cada una conoce sus propias reglas: un
 * producto no se puede dar de baja si tiene movimientos activos, etc.).
 *
 * Cada entrada describe:
 *  - `tabla`: nombre de la tabla en el schema del tenant
 *  - `columnas`: columnas a traer para poder armar una etiqueta legible
 *  - `etiqueta`: cómo construir el texto que ve el usuario en la papelera
 */
type FilaPapelera = Record<string, unknown> & { id: string; deleted_at: Date }

interface DescriptorEntidad {
  tabla: string
  columnas: string
  etiqueta: (fila: FilaPapelera) => string
}

export const ENTIDADES_PAPELERA = {
  producto: {
    tabla: 'productos',
    columnas: 'id, sku, nombre, deleted_at',
    etiqueta: (r) => `${String(r.nombre)}${r.sku ? ` (${String(r.sku)})` : ''}`,
  },
  categoria: {
    tabla: 'categorias',
    columnas: 'id, nombre, deleted_at',
    etiqueta: (r) => String(r.nombre),
  },
  cliente: {
    tabla: 'clientes',
    columnas: 'id, nombre, nit, deleted_at',
    etiqueta: (r) => `${String(r.nombre)}${r.nit ? ` · NIT ${String(r.nit)}` : ''}`,
  },
  proveedor: {
    tabla: 'proveedores',
    columnas: 'id, nombre, nit, deleted_at',
    etiqueta: (r) => `${String(r.nombre)}${r.nit ? ` · NIT ${String(r.nit)}` : ''}`,
  },
  pedido: {
    tabla: 'pedidos',
    columnas: 'id, numero, total, deleted_at',
    etiqueta: (r) => `Pedido ${String(r.numero)} · $${Number(r.total).toLocaleString('es-CO')}`,
  },
  factura_venta: {
    tabla: 'facturas_venta',
    columnas: 'id, numero, total, deleted_at',
    etiqueta: (r) => `Factura de venta ${String(r.numero)} · $${Number(r.total).toLocaleString('es-CO')}`,
  },
  factura_compra: {
    tabla: 'facturas_compra',
    columnas: 'id, numero, total, deleted_at',
    etiqueta: (r) => `Factura de compra ${String(r.numero)} · $${Number(r.total).toLocaleString('es-CO')}`,
  },
  abono: {
    tabla: 'abonos',
    columnas: 'id, monto, referencia, fecha, deleted_at',
    etiqueta: (r) => `Abono $${Number(r.monto).toLocaleString('es-CO')}${r.referencia ? ` · Ref. ${String(r.referencia)}` : ''} (${String(r.fecha)})`,
  },
  evento_calendario: {
    tabla: 'eventos_calendario',
    columnas: 'id, titulo, tipo, deleted_at',
    etiqueta: (r) => `${String(r.titulo)} (${String(r.tipo)})`,
  },
  cuenta_bancaria: {
    tabla: 'cuentas_bancarias',
    columnas: 'id, banco, numero, deleted_at',
    etiqueta: (r) => `${String(r.banco)} · ${String(r.numero)}`,
  },
} satisfies Record<string, DescriptorEntidad>

export type EntidadPapelera = keyof typeof ENTIDADES_PAPELERA

export const ENTIDADES_PAPELERA_VALIDAS = Object.keys(ENTIDADES_PAPELERA) as EntidadPapelera[]

export interface ItemPapelera {
  entidad: EntidadPapelera
  id: string
  etiqueta: string
  eliminadoEn: string
}

/**
 * Junta lo borrado recientemente (últimos 30 días) de todas las entidades,
 * para una sola vista de "deshacer". 30 días es razonable para un historial
 * de undo — suficiente para corregir errores sin volverse un archivo muerto
 * que crece para siempre (las filas más viejas simplemente dejan de listarse,
 * pero no se purgan: seguir necesitando una purga real es una decisión de
 * negocio aparte, no algo que debamos automatizar en silencio).
 */
export async function listarPapelera(tenantDb: NonNullable<FastifyRequest['tenantDb']>): Promise<ItemPapelera[]> {
  const resultados = await Promise.all(
    (Object.entries(ENTIDADES_PAPELERA) as [EntidadPapelera, DescriptorEntidad][]).map(async ([entidad, desc]) => {
      const { rows } = await tenantDb.query<FilaPapelera>(
        `SELECT ${desc.columnas} FROM ${desc.tabla}
         WHERE deleted_at IS NOT NULL AND deleted_at > NOW() - INTERVAL '30 days'
         ORDER BY deleted_at DESC LIMIT 50`,
      )
      return rows.map((fila): ItemPapelera => ({
        entidad,
        id: fila.id,
        etiqueta: desc.etiqueta(fila),
        eliminadoEn: fila.deleted_at.toISOString(),
      }))
    }),
  )

  return resultados.flat().sort((a, b) => b.eliminadoEn.localeCompare(a.eliminadoEn))
}

/** Restaura (deshace el borrado) de una fila — `deleted_at = NULL`. */
export async function restaurarDePapelera(
  tenantDb: NonNullable<FastifyRequest['tenantDb']>,
  entidad: EntidadPapelera,
  id: string,
): Promise<boolean> {
  const desc = ENTIDADES_PAPELERA[entidad]
  const { rowCount } = await tenantDb.query(
    `UPDATE ${desc.tabla} SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id],
  )
  return (rowCount ?? 0) > 0
}
