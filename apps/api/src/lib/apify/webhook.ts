/**
 * Validación HMAC para webhooks de Apify.
 * Apify firma el body con SHA-256 y envía la firma en el header
 * `x-apify-webhook-signature` con el formato `sha256=<hex>`.
 */

import { createHmac, timingSafeEqual } from 'crypto'

export function validarHmacApify(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false

  const received = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')

  // timingSafeEqual previene timing attacks
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))
  } catch {
    return false
  }
}
