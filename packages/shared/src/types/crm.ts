/** Proveedor del tenant — vive en su schema (tabla `proveedores`), espejo de `Cliente`. */
export interface Proveedor {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  contacto: string | null
  activo: boolean
  createdAt: string
}

/** Tipo de entidad sobre la que se registra una nota CRM — FK polimórfica (ver migración 003). */
export const ENTIDADES_CRM = ['cliente', 'proveedor'] as const
export type EntidadCrm = (typeof ENTIDADES_CRM)[number]

/** Nota/interacción de la bitácora CRM — asociada a un cliente o proveedor. */
export interface NotaCrm {
  id: string
  entidadTipo: EntidadCrm
  entidadId: string
  nota: string
  usuarioId: string | null
  createdAt: string
}
