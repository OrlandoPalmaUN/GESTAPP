/**
 * Cómo aterriza la categoría de un gasto en la base.
 *
 * `gastos_operativos` tiene DOS columnas de categoría: `categoria` TEXT, la
 * histórica, y `categoria_id`, la que el reporte de flujo de caja usa para
 * agrupar (LEFT JOIN contra `categorias_gasto`). El agente escribía solo el
 * texto, así que el único gasto que había registrado por WhatsApp era también
 * el único de 86 con `categoria_id` en NULL: salía en la lista de gastos y
 * desaparecía del reporte por categoría.
 *
 * Preguntarle la categoría a la dueña no sirve de nada si después no cuenta
 * donde ella la va a buscar. Eso es lo que se fija acá.
 */
import { describe, it, expect } from 'vitest'
import { executeTool } from '../lib/ai/executor.js'

const CATEGORIAS = [
  { id: 'id-arriendo', clave: 'arriendo' },
  { id: 'id-otros', clave: 'otros' },
  { id: 'id-empaques', clave: 'Empaques' }, // creada por el negocio: slug NULL
]

interface Llamada { sql: string; params: unknown[] }

/**
 * PoolClient falso: responde lo mínimo del camino de registrar_gasto y guarda
 * lo que se le pidió, para poder mirar el INSERT de verdad.
 */
function clienteFalso({ sinTabla = false }: { sinTabla?: boolean } = {}) {
  const llamadas: Llamada[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    llamadas.push({ sql, params })
    if (sql.includes('FROM categorias_gasto')) {
      if (sinTabla) throw new Error('relation "categorias_gasto" does not exist')
      return { rows: CATEGORIAS, rowCount: CATEGORIAS.length }
    }
    if (sql.includes('INSERT INTO gastos_operativos')) {
      return { rows: [{ id: 'gasto-1' }], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  }
  const insert = () => {
    const fila = llamadas.find(l => l.sql.includes('INSERT INTO gastos_operativos'))
    if (!fila) throw new Error('no se insertó ningún gasto')
    // Columnas y params van en el mismo orden: (descripcion, monto,
    // categoria, categoria_id, cuenta_bancaria_id, fecha)
    return { categoria: fila.params[2], categoriaId: fila.params[3], fecha: fila.params[5] }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { query } as any, llamadas, insert }
}

const gasto = (categoria?: string) => ({
  descripcion: 'Empaques de la semana',
  monto: 12000,
  ...(categoria === undefined ? {} : { categoria }),
})

describe('registrar_gasto — la categoría llega a las dos columnas', () => {
  it('guarda el id, no solo el texto', async () => {
    const { db, insert } = clienteFalso()
    const r = await executeTool('registrar_gasto', gasto('arriendo'), db)
    expect(r.success).toBe(true)
    expect(insert()).toMatchObject({ categoria: 'arriendo', categoriaId: 'id-arriendo' })
  })

  it('resuelve una categoría propia del negocio, no solo las de fábrica', async () => {
    // 'Empaques' no está en CATEGORIAS_GASTO: con la lista vieja habría caído
    // a 'otros' aunque la dueña la hubiera creado y elegido a propósito.
    const { db, insert } = clienteFalso()
    await executeTool('registrar_gasto', gasto('empaques'), db)
    expect(insert()).toMatchObject({ categoria: 'Empaques', categoriaId: 'id-empaques' })
  })

  it('una categoría que no existe cae a otros CON su id', async () => {
    // El enum del esquema ya no deja llegar acá un "kerlys", pero el executor
    // no confía en eso: si llega, no puede quedar huérfano del reporte.
    const { db, insert } = clienteFalso()
    await executeTool('registrar_gasto', gasto('kerlys'), db)
    expect(insert()).toMatchObject({ categoria: 'otros', categoriaId: 'id-otros' })
  })

  it('sin tabla de categorías registra igual en vez de perder el gasto', async () => {
    // Un tenant sin la migración 027 no puede quedarse sin poder registrar.
    // La lectura va FUERA del BEGIN justamente para que el error no aborte la
    // transacción y se lleve el gasto con él.
    const { db, insert, llamadas } = clienteFalso({ sinTabla: true })
    const r = await executeTool('registrar_gasto', gasto('arriendo'), db)
    expect(r.success).toBe(true)
    expect(insert()).toMatchObject({ categoria: 'arriendo', categoriaId: null })
    const orden = llamadas.map(l => l.sql.trim().split('\n')[0]!.trim())
    expect(orden.findIndex(q => q.includes('categorias_gasto')))
      .toBeLessThan(orden.indexOf('BEGIN'))
  })

  it('un fecha null sigue cayendo en CURRENT_DATE', async () => {
    // El bug que ya costó un gasto de $2.000: el modelo manda null en los
    // opcionales que no conoce.
    const { db, insert } = clienteFalso()
    await executeTool('registrar_gasto', { ...gasto('arriendo'), fecha: null }, db)
    expect(insert().fecha).toBeNull()
  })
})
