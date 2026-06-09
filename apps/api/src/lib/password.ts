import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

const KEY_LENGTH = 64

/**
 * Hash de contraseñas con scrypt (módulo `crypto` nativo de Node — sin
 * dependencias externas ni binarios nativos que compilar, a diferencia de
 * bcrypt/argon2). Formato almacenado: `<salt-hex>:<hash-hex>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`
}

/**
 * Compara una contraseña en texto plano contra un hash almacenado.
 * Usa `timingSafeEqual` para no filtrar información por timing attacks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false

  const salt = Buffer.from(saltHex, 'hex')
  const storedHash = Buffer.from(hashHex, 'hex')
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer

  if (storedHash.length !== derivedKey.length) return false
  return timingSafeEqual(storedHash, derivedKey)
}
