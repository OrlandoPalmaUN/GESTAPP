/**
 * Estado de navegación en la URL.
 *
 * La app entera vivía en `useState`: `activeTab`, los sub-tabs de Finanzas y
 * Comunicaciones y el pedido abierto no dejaban ningún rastro en la barra de
 * direcciones. Eso costaba tres cosas todos los días:
 *
 * - No se podía mandar el link de un pedido a un empleado. El flujo era
 *   "abrí la app, andá a Pedidos, buscá" — y WhatsApp es el canal real de
 *   estas PYMEs.
 * - Refrescar a mitad de tarea devolvía al Dashboard con todo el contexto
 *   perdido.
 * - El botón Atrás de Android SALÍA de la app en vez de cerrar el modal o
 *   volver a la pestaña anterior. Es el botón más presionado del teléfono.
 *
 * Se usa la History API del navegador en vez de `useSearchParams` de Next a
 * propósito: `useSearchParams` obliga a envolver la página en un `<Suspense>`
 * y a reestructurar el export por defecto de un componente de 9.800 líneas.
 * Esto entrega el mismo beneficio sin tocar esa estructura. Cuando cada módulo
 * tenga su propia ruta, este archivo se retira.
 */

/** Valores aceptados en la URL. Un link editado a mano con un valor que no
 *  esté acá cae al default en vez de dejar la app en un estado inexistente. */
export const TABS_VALIDAS = [
  'dashboard', 'pedidos', 'inventario', 'finanzas', 'flujocaja', 'crm',
  'comunicaciones', 'reportes', 'auditoria', 'config',
] as const

export const FINANZAS_SUBTABS_VALIDAS = ['resumen', 'cxc', 'cxp', 'compras', 'gastos', 'ingresos'] as const
export const COM_SUBTABS_VALIDAS = ['calendario', 'redes', 'notas'] as const

export interface EstadoUrl {
  tab: string
  finanzas?: string
  com?: string
  /** Pedido abierto en el Gestor. */
  pedido?: string
}

const CLAVES = ['tab', 'finanzas', 'com', 'pedido'] as const

/**
 * Valor inicial de un estado de navegación, leído de la URL.
 *
 * Se usa como inicializador de `useState` en vez de restaurar dentro de un
 * `useEffect` a propósito: con el efecto había una carrera real. El
 * `LoadingGate` monta la página mientras resuelve la sesión, el efecto que
 * escribe la URL corría con el valor viejo todavía en el render, y sobrescribía
 * `?tab=pedidos` por `?tab=dashboard` antes de que el `setState` del restore
 * llegara a aplicarse. Inicializando acá no hay nada que corregir después.
 */
export function valorInicialDeUrl<T extends string>(
  clave: keyof EstadoUrl,
  validos: readonly T[],
  porDefecto: T,
): T {
  if (typeof window === 'undefined') return porDefecto
  const v = new URLSearchParams(window.location.search).get(clave)
  return v && (validos as readonly string[]).includes(v) ? (v as T) : porDefecto
}

/** Id del pedido a abrir según la URL, si viene. */
export function pedidoInicialDeUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('pedido')
}

export function leerEstadoUrl(): EstadoUrl | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search)
  const tab = p.get('tab')
  if (!tab) return null
  const estado: EstadoUrl = { tab }
  for (const k of CLAVES) {
    if (k === 'tab') continue
    const v = p.get(k)
    if (v) estado[k] = v
  }
  return estado
}

/**
 * Escribe el estado en la URL.
 *
 * `push` agrega una entrada al historial (para que Atrás vuelva acá);
 * `replace` la reemplaza, que es lo correcto en la carga inicial para no
 * dejar una entrada fantasma antes de la primera pantalla.
 */
export function escribirEstadoUrl(estado: EstadoUrl, modo: 'push' | 'replace' = 'push'): void {
  if (typeof window === 'undefined') return

  const p = new URLSearchParams()
  p.set('tab', estado.tab)
  for (const k of CLAVES) {
    if (k === 'tab') continue
    const v = estado[k]
    if (v) p.set(k, v)
  }

  const url = `${window.location.pathname}?${p.toString()}`
  if (url === `${window.location.pathname}${window.location.search}`) return

  if (modo === 'push') window.history.pushState(estado, '', url)
  else window.history.replaceState(estado, '', url)
}
