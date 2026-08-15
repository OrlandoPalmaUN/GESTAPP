/**
 * Formato de moneda y fecha para Colombia, en un solo lugar.
 *
 * Antes convivían dos formatos de moneda en la misma pantalla de Finanzas
 * (`'$' + toLocaleString('es-CO')` → `$1.234.567` y `style:'currency'` →
 * `$ 1.234.567`), y se filtraban fechas ISO crudas al usuario (`2026-08-15`,
 * `2026-08-01 → 2026-08-31`).
 */

/**
 * `$1.234.567` — el peso colombiano no usa centavos, así que se redondea.
 * En negativos el signo va ANTES del símbolo (`-$500`, no `$-500`).
 */
export function money(valor: number | null | undefined): string {
  if (valor == null || Number.isNaN(valor)) return '$0'
  const n = Math.round(valor)
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('es-CO')}`
}

/** Como `money`, pero con signo explícito — para deltas y flujos. */
export function moneySigned(valor: number | null | undefined): string {
  if (valor == null || Number.isNaN(valor)) return '$0'
  const signo = valor < 0 ? '-' : '+'
  return `${signo}$${Math.abs(Math.round(valor)).toLocaleString('es-CO')}`
}

/**
 * Acepta `YYYY-MM-DD` o un ISO completo y devuelve `15 ago 2026`.
 *
 * El `T00:00:00` es deliberado: `new Date('2026-08-15')` se interpreta como
 * UTC y en Colombia (UTC-5) se muestra como el 14 — un día menos. Con la hora
 * explícita se interpreta en zona local y la fecha no se corre.
 */
export function fecha(valor: string | Date | null | undefined): string {
  if (!valor) return '—'
  const d = typeof valor === 'string'
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T00:00:00` : valor)
    : valor
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** `15 ago` — para listas densas donde el año se sobreentiende. */
export function fechaCorta(valor: string | Date | null | undefined): string {
  if (!valor) return '—'
  const d = typeof valor === 'string'
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T00:00:00` : valor)
    : valor
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

/** `1 ago 2026 – 31 ago 2026` para el encabezado de un período. */
export function rangoFechas(desde: string, hasta: string): string {
  return `${fecha(desde)} – ${fecha(hasta)}`
}

/**
 * Convierte lo que el usuario escribe en un input de pesos a número.
 * Ignora puntos de miles, espacios y el `$`; acepta coma como separador
 * decimal por si alguien la usa, aunque el peso no lleve centavos.
 */
export function parseMoney(texto: string): number {
  const limpio = texto.replace(/[^\d,-]/g, '').replace(',', '.')
  const n = parseFloat(limpio)
  return Number.isNaN(n) ? 0 : Math.round(n)
}

/** Agrupa en miles mientras se escribe: `1250000` → `1.250.000`. */
export function formatMoneyInput(texto: string): string {
  const soloDigitos = texto.replace(/\D/g, '')
  if (!soloDigitos) return ''
  return Number(soloDigitos).toLocaleString('es-CO')
}
