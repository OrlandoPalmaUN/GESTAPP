/**
 * Validación y lectura del webhook de la WhatsApp Cloud API.
 *
 * El endpoint es PÚBLICO: sin firma validada, cualquiera que conozca la URL
 * puede inyectar mensajes falsos, hacer que el agente escriba a números
 * arbitrarios y quemar la cuota diaria de LLM. La firma es la única cosa que
 * distingue un webhook de Meta de un POST cualquiera, así que no es opcional.
 *
 * Mismo patrón que `lib/apify/webhook.ts` (HMAC-SHA256 sobre el body crudo +
 * `timingSafeEqual`); cambia el nombre del header y que Meta firma con el
 * App Secret de la app, no con un secreto que elegimos nosotros.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Valida `X-Hub-Signature-256: sha256=<hex>` contra el App Secret.
 *
 * Sobre el body CRUDO, no sobre el JSON reserializado: `JSON.parse` +
 * `JSON.stringify` cambia espacios y orden de claves, y entonces la firma
 * nunca coincide. De ahí el content-type parser de la ruta.
 */
export function validarFirmaMeta(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false

  const recibida = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader

  const esperada = createHmac('sha256', appSecret).update(rawBody).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(recibida, 'hex'))
  } catch {
    // Longitudes distintas (o hex inválido) — firma inválida, no un error.
    return false
  }
}

// ── Forma del payload ───────────────────────────────────────────────────────
// Solo se declara lo que se usa. Meta manda bastante más (statuses de entrega,
// errores, referrals de anuncios) y el payload completo se guarda en
// `wa_mensajes.raw` para no perder lo que todavía no se interpreta.

export interface MetaMensaje {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
}

export interface MetaContacto {
  wa_id: string
  profile?: { name?: string }
}

export interface MetaCambio {
  phoneNumberId: string
  wabaId: string | null
  mensajes: MetaMensaje[]
  contactos: MetaContacto[]
}

interface MetaWebhookBody {
  object?: string
  entry?: {
    id?: string
    changes?: {
      field?: string
      value?: {
        metadata?: { phone_number_id?: string }
        contacts?: MetaContacto[]
        messages?: MetaMensaje[]
      }
    }[]
  }[]
}

/**
 * Aplana el payload en un cambio por número de teléfono.
 *
 * Un solo POST puede traer varios `entry`, cada uno con varios `changes`, y en
 * teoría de números distintos — así que el tenant se resuelve por cambio, no
 * por request. Se descarta todo lo que no sea del campo `messages` con
 * mensajes adentro: los `statuses` (entregado, leído) entran por el mismo
 * webhook y no son nada que el agente deba contestar.
 */
export function leerCambios(body: unknown): MetaCambio[] {
  const payload = body as MetaWebhookBody
  const cambios: MetaCambio[] = []

  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue

      const phoneNumberId = change.value?.metadata?.phone_number_id
      const mensajes = change.value?.messages ?? []
      if (!phoneNumberId || mensajes.length === 0) continue

      cambios.push({
        phoneNumberId,
        wabaId: entry.id ?? null,
        mensajes,
        contactos: change.value?.contacts ?? [],
      })
    }
  }

  return cambios
}

/**
 * Texto del mensaje, o null si es de un tipo que todavía no se interpreta
 * (audio, imagen, ubicación, sticker…). Null NO es "mensaje vacío": es
 * "llegó algo que no sé leer", y quien llama decide qué contestar.
 */
export function textoDelMensaje(mensaje: MetaMensaje): string | null {
  if (mensaje.type === 'text') return mensaje.text?.body?.trim() || null
  return null
}
