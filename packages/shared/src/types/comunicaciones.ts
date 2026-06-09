/**
 * Comunicaciones — calendario/planner (notas, recordatorios y posts
 * planeados para redes sociales). Es la mitad "real" del módulo: vive en su
 * propia tabla `eventos_calendario`, conectada al backend como cualquier otro
 * módulo. El dashboard de métricas sociales (seguidores, alcance, etc.) sigue
 * siendo mock hasta conectar una cuenta real de Meta.
 */

export const TIPOS_EVENTO_CALENDARIO = ['nota', 'recordatorio', 'post'] as const
export type TipoEventoCalendario = (typeof TIPOS_EVENTO_CALENDARIO)[number]

export const CANALES_POST = ['instagram', 'facebook', 'tiktok'] as const
export type CanalPost = (typeof CANALES_POST)[number]

/**
 * Estados del evento de calendario.
 * - notas/recordatorios: pendiente → hecho
 * - posts (contenido): idea → grabado → editado → subido
 */
export const ESTADOS_EVENTO_CALENDARIO = ['pendiente', 'hecho', 'idea', 'grabado', 'editado', 'subido'] as const
export type EstadoEventoCalendario = (typeof ESTADOS_EVENTO_CALENDARIO)[number]

/** Flujo de producción de contenido — transiciones válidas por estado. */
export const TRANSICIONES_EVENTO: Partial<Record<EstadoEventoCalendario, EstadoEventoCalendario[]>> = {
  idea:     ['grabado', 'hecho'],
  grabado:  ['editado'],
  editado:  ['subido'],
  pendiente: ['hecho'],
  // hecho y subido son estados terminales — sin transición desde aquí
}

export interface EventoCalendario {
  id: string
  tipo: TipoEventoCalendario
  titulo: string
  descripcion: string | null
  fecha: string
  canal: CanalPost | null
  estado: EstadoEventoCalendario
  usuarioId: string | null
  createdAt: string
}

/** Estados por defecto al crear, según el tipo de evento. */
export const ESTADO_INICIAL_POR_TIPO: Record<TipoEventoCalendario, EstadoEventoCalendario> = {
  nota: 'pendiente',
  recordatorio: 'pendiente',
  post: 'idea',
}

/** Ítem individual dentro de una nota en modo checklist. */
export interface ChecklistItem {
  id: string
  texto: string
  checked: boolean
  orden: number
}

/**
 * Nota interna — módulo "Notas" de Comunicaciones (similar a iPhone Notes).
 * Tiene título + contenido libre y un checkbox opcional para marcarla globalmente
 * como completada. El campo `orden` permite reordenación manual.
 */
export interface NotaInterna {
  id: string
  titulo: string
  /** 'texto' → HTML rico; 'lista' → JSON de ChecklistItem[]. */
  tipoContenido: 'texto' | 'lista'
  contenido: string | null
  tieneCheckbox: boolean
  completada: boolean
  orden: number
  usuarioId: string | null
  createdAt: string
}
