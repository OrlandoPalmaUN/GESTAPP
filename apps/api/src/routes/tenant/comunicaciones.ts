import {
  actualizarEventoCalendarioSchema,
  actualizarNotaInternaSchema,
  crearEventoCalendarioSchema,
  crearNotaInternaSchema,
  ESTADO_INICIAL_POR_TIPO,
  listarEventosCalendarioQuerySchema,
  type CanalPost,
  type EstadoEventoCalendario,
  type EventoCalendario,
  type NotaInterna,
  type TipoEventoCalendario,
} from '@antigravity/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

interface FilaEventoCalendario {
  id: string
  tipo: string
  titulo: string
  descripcion: string | null
  fecha: Date
  canal: string | null
  estado: string
  usuario_id: string | null
  created_at: Date
}

function aEventoCalendario(row: FilaEventoCalendario): EventoCalendario {
  return {
    id: row.id,
    tipo: row.tipo as TipoEventoCalendario,
    titulo: row.titulo,
    descripcion: row.descripcion,
    fecha: row.fecha.toISOString().slice(0, 10),
    canal: row.canal as CanalPost | null,
    estado: row.estado as EstadoEventoCalendario,
    usuarioId: row.usuario_id,
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

const COLUMNAS = 'id, tipo, titulo, descripcion, fecha, canal, estado, usuario_id, created_at'

/**
 * Rutas de Comunicaciones — calendario/planner (notas, recordatorios y posts
 * planeados para redes sociales). Es la mitad "real" del módulo: persiste en
 * `eventos_calendario` (migración 005). El dashboard de métricas sociales
 * sigue siendo mock hasta que el negocio conecte una cuenta real de Meta.
 */
export async function comunicacionesRoutes(fastify: FastifyInstance): Promise<void> {
  const conSesion = { preHandler: [fastify.authenticate] }

  // GET /comunicaciones/eventos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
  fastify.get<{ Querystring: { desde?: string; hasta?: string } }>(
    '/comunicaciones/eventos',
    conSesion,
    async (request, reply) => {
      if (!exigirTenant(request, reply)) return

      const query = listarEventosCalendarioQuerySchema.safeParse(request.query)
      if (!query.success) return reply.badRequest(query.error.issues.map((i) => i.message).join('; '))

      const condiciones: string[] = ['deleted_at IS NULL']
      const valores: string[] = []
      if (query.data.desde) {
        valores.push(query.data.desde)
        condiciones.push(`fecha >= $${valores.length}`)
      }
      if (query.data.hasta) {
        valores.push(query.data.hasta)
        condiciones.push(`fecha <= $${valores.length}`)
      }
      const whereClause = `WHERE ${condiciones.join(' AND ')}`

      const { rows } = await request.tenantDb.query<FilaEventoCalendario>(
        `SELECT ${COLUMNAS} FROM eventos_calendario ${whereClause} ORDER BY fecha ASC, created_at ASC`,
        valores,
      )
      return reply.send({ eventos: rows.map(aEventoCalendario) })
    },
  )

  // POST /comunicaciones/eventos
  fastify.post('/comunicaciones/eventos', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearEventoCalendarioSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    const estado = body.data.estado ?? ESTADO_INICIAL_POR_TIPO[body.data.tipo]
    const canal = body.data.tipo === 'post' ? (body.data.canal ?? null) : null

    const { rows } = await request.tenantDb.query<FilaEventoCalendario>(
      `INSERT INTO eventos_calendario (tipo, titulo, descripcion, fecha, canal, estado, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNAS}`,
      [
        body.data.tipo,
        body.data.titulo,
        body.data.descripcion ?? null,
        body.data.fecha,
        canal,
        estado,
        request.user.sub,
      ],
    )
    return reply.status(201).send({ evento: aEventoCalendario(rows[0]!) })
  })

  // PATCH /comunicaciones/eventos/:id
  fastify.patch<{ Params: { id: string } }>('/comunicaciones/eventos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('El identificador del evento no es válido.')

    const body = actualizarEventoCalendarioSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No hay cambios para aplicar.')

    const actual = await request.tenantDb.query<FilaEventoCalendario>(
      `SELECT ${COLUMNAS} FROM eventos_calendario WHERE id = $1 AND deleted_at IS NULL`,
      [idParsed.data],
    )
    if (actual.rowCount === 0) return reply.notFound('El evento indicado no existe.')

    const sets: string[] = []
    const valores: unknown[] = []
    const agregar = (columna: string, valor: unknown) => {
      valores.push(valor)
      sets.push(`${columna} = $${valores.length}`)
    }

    if (body.data.titulo !== undefined) agregar('titulo', body.data.titulo)
    if (body.data.descripcion !== undefined) agregar('descripcion', body.data.descripcion)
    if (body.data.fecha !== undefined) agregar('fecha', body.data.fecha)
    if (body.data.estado !== undefined) agregar('estado', body.data.estado)
    if (body.data.canal !== undefined) {
      // El canal solo tiene sentido para posts — para notas/recordatorios siempre va NULL.
      const tipoFinal = actual.rows[0]!.tipo
      agregar('canal', tipoFinal === 'post' ? body.data.canal : null)
    }

    valores.push(idParsed.data)
    const { rows } = await request.tenantDb.query<FilaEventoCalendario>(
      `UPDATE eventos_calendario SET ${sets.join(', ')} WHERE id = $${valores.length} AND deleted_at IS NULL RETURNING ${COLUMNAS}`,
      valores,
    )
    return reply.send({ evento: aEventoCalendario(rows[0]!) })
  })

  // DELETE /comunicaciones/eventos/:id — borrado suave: queda en /papelera y se puede deshacer.
  fastify.delete<{ Params: { id: string } }>('/comunicaciones/eventos/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return

    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('El identificador del evento no es válido.')

    const { rowCount } = await request.tenantDb.query(
      'UPDATE eventos_calendario SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [idParsed.data],
    )
    if (rowCount === 0) return reply.notFound('El evento indicado no existe.')
    return reply.status(204).send()
  })

  // ──────────────────────────────────────────────────────────────────
  // NOTAS INTERNAS — módulo tipo "iPhone Notes" dentro de Comunicaciones
  // ──────────────────────────────────────────────────────────────────

  interface FilaNotaInterna {
    id: string
    titulo: string
    tipo_contenido: string
    contenido: string | null
    tiene_checkbox: boolean
    completada: boolean
    orden: number
    usuario_id: string | null
    created_at: Date
  }

  function aNotaInterna(row: FilaNotaInterna): NotaInterna {
    return {
      id: row.id,
      titulo: row.titulo,
      tipoContenido: (row.tipo_contenido ?? 'texto') as 'texto' | 'lista',
      contenido: row.contenido,
      tieneCheckbox: row.tiene_checkbox,
      completada: row.completada,
      orden: row.orden,
      usuarioId: row.usuario_id,
      createdAt: row.created_at.toISOString(),
    }
  }

  const COLS_NOTA = 'id, titulo, tipo_contenido, contenido, tiene_checkbox, completada, orden, usuario_id, created_at'

  // GET /comunicaciones/notas
  fastify.get('/comunicaciones/notas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const { rows } = await request.tenantDb.query<FilaNotaInterna>(
      `SELECT ${COLS_NOTA} FROM notas_internas WHERE deleted_at IS NULL ORDER BY orden ASC, created_at ASC`,
    )
    return reply.send({ notas: rows.map(aNotaInterna) })
  })

  // POST /comunicaciones/notas
  fastify.post('/comunicaciones/notas', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const body = crearNotaInternaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))

    // El orden por defecto es max(orden) + 1 para que la nota nueva quede al final.
    const { rows: maxRows } = await request.tenantDb.query<{ max_orden: string | null }>(
      'SELECT MAX(orden)::text AS max_orden FROM notas_internas WHERE deleted_at IS NULL',
    )
    const orden = (Number(maxRows[0]?.max_orden ?? '-1') + 1)

    const { rows } = await request.tenantDb.query<FilaNotaInterna>(
      `INSERT INTO notas_internas (titulo, tipo_contenido, contenido, tiene_checkbox, orden, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLS_NOTA}`,
      [body.data.titulo, body.data.tipoContenido, body.data.contenido ?? null, body.data.tieneCheckbox, orden, request.user.sub],
    )
    return reply.status(201).send({ nota: aNotaInterna(rows[0]!) })
  })

  // PATCH /comunicaciones/notas/:id — editar título/contenido/checkbox/completada/orden
  fastify.patch<{ Params: { id: string } }>('/comunicaciones/notas/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de nota no válido.')

    const body = actualizarNotaInternaSchema.safeParse(request.body)
    if (!body.success) return reply.badRequest(body.error.issues.map((i) => i.message).join('; '))
    if (Object.keys(body.data).length === 0) return reply.badRequest('No hay campos para actualizar.')

    const sets: string[] = []
    const valores: unknown[] = []
    const ag = (col: string, val: unknown) => { valores.push(val); sets.push(`${col} = $${valores.length}`) }

    if (body.data.titulo !== undefined) ag('titulo', body.data.titulo)
    if (body.data.tipoContenido !== undefined) ag('tipo_contenido', body.data.tipoContenido)
    if (body.data.contenido !== undefined) ag('contenido', body.data.contenido)
    if (body.data.tieneCheckbox !== undefined) ag('tiene_checkbox', body.data.tieneCheckbox)
    if (body.data.completada !== undefined) ag('completada', body.data.completada)
    if (body.data.orden !== undefined) ag('orden', body.data.orden)

    valores.push(idParsed.data)
    const { rows, rowCount } = await request.tenantDb.query<FilaNotaInterna>(
      `UPDATE notas_internas SET ${sets.join(', ')} WHERE id = $${valores.length} AND deleted_at IS NULL RETURNING ${COLS_NOTA}`,
      valores,
    )
    if (rowCount === 0) return reply.notFound('Nota no encontrada.')
    return reply.send({ nota: aNotaInterna(rows[0]!) })
  })

  // DELETE /comunicaciones/notas/:id — borrado suave
  fastify.delete<{ Params: { id: string } }>('/comunicaciones/notas/:id', conSesion, async (request, reply) => {
    if (!exigirTenant(request, reply)) return
    const idParsed = z.uuid().safeParse(request.params.id)
    if (!idParsed.success) return reply.badRequest('ID de nota no válido.')

    const { rowCount } = await request.tenantDb.query(
      'UPDATE notas_internas SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
      [idParsed.data],
    )
    if (rowCount === 0) return reply.notFound('Nota no encontrada.')
    return reply.status(204).send()
  })
}
