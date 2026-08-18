/**
 * Compartir por WhatsApp.
 *
 * Es el canal real de estas PYMEs: los pedidos de Nalu llegan etiquetados
 * "La Tricolor · Instagram" y se coordinan por chat. Hasta ahora la app no
 * tenía ninguna forma de sacar información hacia afuera — había dos stubs
 * comentados ("WhatsApp Business Test") sin nada detrás.
 *
 * Esto NO es la API de WhatsApp Business: es un link `wa.me` que abre el chat
 * con el mensaje ya escrito, y la persona lo envía. Sin costo, sin registro de
 * negocio en Meta y sin credenciales — y por eso mismo tampoco puede mandar
 * nada sin que un humano lo confirme, que es lo correcto.
 */

import { money, fecha } from './format'

/**
 * Deja el teléfono como lo quiere wa.me: solo dígitos con indicativo de país.
 * Los números colombianos suelen guardarse como "300 123 4567" o
 * "+57 300 123 4567"; si vienen sin indicativo se asume Colombia (57).
 */
export function normalizarTelefono(tel: string | null | undefined): string | null {
  if (!tel) return null
  const digitos = tel.replace(/\D/g, '')
  if (digitos.length === 0) return null
  if (digitos.startsWith('57')) return digitos
  if (digitos.length === 10) return `57${digitos}` // celular colombiano
  return digitos
}

/** Arma el link de WhatsApp. Sin teléfono abre el selector de contacto. */
export function linkWhatsApp(telefono: string | null | undefined, mensaje: string): string {
  const num = normalizarTelefono(telefono)
  const texto = encodeURIComponent(mensaje)
  return num ? `https://wa.me/${num}?text=${texto}` : `https://wa.me/?text=${texto}`
}

export interface ItemResumen {
  nombre: string
  cantidad: number
  precioUnitario: number
}

/** Mensaje de confirmación de un pedido, listo para enviar al cliente. */
export function mensajePedido(opts: {
  empresa: string
  numero: string
  cliente?: string | null
  items: ItemResumen[]
  total: number
  saldoPendiente?: number | null
  estado: string
  url?: string
}): string {
  const lineas: string[] = []
  lineas.push(`*${opts.empresa}* — Pedido ${opts.numero}`)
  if (opts.cliente) lineas.push(`Cliente: ${opts.cliente}`)
  lineas.push('')
  for (const it of opts.items) {
    lineas.push(`• ${it.cantidad} × ${it.nombre} — ${money(it.cantidad * it.precioUnitario)}`)
  }
  lineas.push('')
  lineas.push(`*Total: ${money(opts.total)}*`)
  if (opts.saldoPendiente != null && opts.saldoPendiente > 0) {
    lineas.push(`Saldo pendiente: ${money(opts.saldoPendiente)}`)
  }
  lineas.push(`Estado: ${opts.estado.replace(/_/g, ' ')}`)
  if (opts.url) {
    lineas.push('')
    lineas.push(opts.url)
  }
  return lineas.join('\n')
}

/** Estado de cuenta de un cliente: qué debe y desde cuándo. */
export function mensajeEstadoDeCuenta(opts: {
  empresa: string
  cliente: string
  facturas: { numero: string; fechaVencimiento: string; saldo: number }[]
  total: number
}): string {
  const lineas: string[] = []
  lineas.push(`*${opts.empresa}* — Estado de cuenta`)
  lineas.push(`Cliente: ${opts.cliente}`)
  lineas.push('')
  for (const f of opts.facturas) {
    lineas.push(`• ${f.numero} — vence ${fecha(f.fechaVencimiento)} — ${money(f.saldo)}`)
  }
  lineas.push('')
  lineas.push(`*Saldo total: ${money(opts.total)}*`)
  return lineas.join('\n')
}
