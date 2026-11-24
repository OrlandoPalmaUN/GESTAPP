/**
 * Cliente de salida de la WhatsApp Cloud API.
 *
 * Solo mensajes de texto libres, que es lo único que un bot que RESPONDE
 * necesita: dentro de la ventana de servicio de 24h (la que abre el cliente al
 * escribir) no cuestan nada. Las plantillas — que sí se cobran y hay que
 * someterlas a aprobación de Meta — harían falta para ESCRIBIR primero, y eso
 * no es lo que hace este canal.
 */

/** Tope de un mensaje de texto en WhatsApp. Pasarse es un 400 de Graph. */
const MAX_CARACTERES = 4096

export interface EnvioWhatsapp {
  token: string
  phoneNumberId: string
  graphVersion: string
  /** Destinatario en E.164 sin "+" — el mismo `wa_id` que llegó en el webhook. */
  to: string
  texto: string
}

/**
 * Envía el texto y devuelve el `message.id` que asigna Meta, para guardarlo en
 * `wa_mensajes` con la misma PK que usan los entrantes.
 *
 * Lanza si Graph no responde 2xx: el que llama decide si reintenta. No se
 * reintenta acá adentro a propósito — un reintento ciego sobre un timeout
 * puede mandar el mismo mensaje dos veces, que es peor que no mandarlo.
 */
export async function enviarTextoWhatsapp(envio: EnvioWhatsapp): Promise<string | null> {
  const texto =
    envio.texto.length > MAX_CARACTERES
      ? `${envio.texto.slice(0, MAX_CARACTERES - 1)}…`
      : envio.texto

  const res = await fetch(
    `https://graph.facebook.com/${envio.graphVersion}/${envio.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${envio.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: envio.to,
        type: 'text',
        // `preview_url: false` — si no, un link en la respuesta se expande en
        // una tarjeta de preview, que en un chat de negocio es ruido.
        text: { preview_url: false, body: texto },
      }),
    },
  )

  const body = (await res.json().catch(() => null)) as {
    messages?: { id: string }[]
    error?: { message?: string; code?: number }
  } | null

  if (!res.ok) {
    throw new Error(
      `Graph API ${res.status}: ${body?.error?.message ?? 'sin detalle'}${
        body?.error?.code ? ` (code ${body.error.code})` : ''
      }`,
    )
  }

  return body?.messages?.[0]?.id ?? null
}
