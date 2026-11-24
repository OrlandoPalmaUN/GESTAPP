/**
 * Configura el canal de WhatsApp de una empresa: asocia el número de Meta al
 * tenant y autoriza los celulares que pueden hablarle al agente.
 *
 * Es un script y no una pantalla a propósito: esto se hace una vez por empresa,
 * los datos salen del dashboard de Meta (no de la app) y meterlo en la UI
 * significaría exponer la asociación número ↔ empresa a un admin de tenant,
 * que es justo lo que no queremos tocar desde afuera.
 *
 * Uso:
 *   cd apps/api
 *   # asociar el número de Meta a una empresa
 *   pnpm tsx src/scripts/wa-configurar.ts numero <slug> <phone_number_id> [waba_id]
 *   # autorizar un celular para que el agente le conteste
 *   pnpm tsx src/scripts/wa-configurar.ts autorizar <slug> <celular> [email_usuario]
 *   # ver cómo está configurado
 *   pnpm tsx src/scripts/wa-configurar.ts ver <slug>
 *
 * El `email_usuario` es opcional pero conviene: es lo que hace que la auditoría
 * registre a una persona detrás de cada cosa que el agente haga por WhatsApp.
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pkg from 'pg'

const { Pool } = pkg

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

/**
 * Deja el celular como lo manda Meta en `wa_id`: solo dígitos, con indicativo.
 * Un número colombiano guardado como "300 123 4567" no coincide con el
 * "573001234567" del webhook, y el contacto quedaría sin autorizar sin que se
 * vea por qué. Mismo criterio que `apps/web/lib/whatsapp.ts`.
 */
function normalizarWaId(tel: string): string {
  const digitos = tel.replace(/\D/g, '')
  if (digitos.startsWith('57')) return digitos
  if (digitos.length === 10) return `57${digitos}`
  return digitos
}

const [accion, slug, arg3, arg4] = process.argv.slice(2)

if (!accion || !slug) {
  console.error('Faltan argumentos. Ver el encabezado del archivo para el uso.')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const client = await pool.connect()

try {
  const tenant = await client.query<{ id: string; name: string; schema_name: string }>(
    'SELECT id, name, schema_name FROM public.tenants WHERE slug = $1',
    [slug],
  )
  const empresa = tenant.rows[0]
  if (!empresa) {
    console.error(`❌ No existe un tenant con slug "${slug}".`)
    process.exit(1)
  }

  if (accion === 'numero') {
    if (!arg3) {
      console.error('❌ Falta el phone_number_id (lo da el dashboard de Meta).')
      process.exit(1)
    }
    await client.query(
      `INSERT INTO public.tenant_whatsapp_numbers (phone_number_id, tenant_id, waba_id, activo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (phone_number_id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             waba_id   = COALESCE(EXCLUDED.waba_id, public.tenant_whatsapp_numbers.waba_id),
             activo    = true`,
      [arg3, empresa.id, arg4 ?? null],
    )
    console.log(`✅ Número ${arg3} asociado a "${empresa.name}".`)
  } else if (accion === 'autorizar') {
    if (!arg3) {
      console.error('❌ Falta el celular a autorizar.')
      process.exit(1)
    }
    const waId = normalizarWaId(arg3)

    let usuarioId: string | null = null
    if (arg4) {
      const u = await client.query<{ id: string }>(
        'SELECT id FROM public.usuarios WHERE email = $1 AND (tenant_id = $2 OR rol = $3)',
        [arg4, empresa.id, 'superadmin'],
      )
      usuarioId = u.rows[0]?.id ?? null
      if (!usuarioId) {
        console.error(`❌ No hay un usuario "${arg4}" en esta empresa.`)
        process.exit(1)
      }
    }

    // El search_path apunta al schema del tenant: las tablas wa_* son suyas.
    await client.query(`SET search_path TO "${empresa.schema_name}", public`)
    await client.query(
      `INSERT INTO wa_contactos (wa_id, usuario_id, autorizado)
       VALUES ($1, $2, true)
       ON CONFLICT (wa_id) DO UPDATE
         SET autorizado = true,
             usuario_id = COALESCE(EXCLUDED.usuario_id, wa_contactos.usuario_id)`,
      [waId, usuarioId],
    )
    await client.query(
      `INSERT INTO wa_conversaciones (wa_id) VALUES ($1) ON CONFLICT (wa_id) DO NOTHING`,
      [waId],
    )
    console.log(
      `✅ ${waId} autorizado en "${empresa.name}"${usuarioId ? ` como ${arg4}` : ' (sin usuario asociado)'}.`,
    )
  } else if (accion === 'ver') {
    const numeros = await client.query(
      'SELECT phone_number_id, waba_id, display_number, activo FROM public.tenant_whatsapp_numbers WHERE tenant_id = $1',
      [empresa.id],
    )
    console.log(`📱 Números de "${empresa.name}":`)
    console.table(numeros.rows)

    await client.query(`SET search_path TO "${empresa.schema_name}", public`)
    const contactos = await client.query(
      `SELECT c.wa_id, c.profile_name, c.autorizado, c.usuario_id, conv.estado
         FROM wa_contactos c
         LEFT JOIN wa_conversaciones conv ON conv.wa_id = c.wa_id
        ORDER BY c.ultimo_mensaje_at DESC LIMIT 20`,
    )
    console.log('👤 Contactos:')
    console.table(contactos.rows)
  } else {
    console.error(`❌ Acción desconocida: "${accion}". Usá numero | autorizar | ver.`)
    process.exit(1)
  }
} finally {
  await client.query('RESET search_path').catch(() => undefined)
  client.release()
  await pool.end()
}
