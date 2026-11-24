/**
 * El canal de WhatsApp enchufado al agente que ya existe.
 *
 * Esto NO es un agente nuevo: las herramientas, el executor que valida todo lo
 * que viene del LLM y el system prompt con datos reales del negocio son los
 * mismos de `POST /ai/chat` (ver `lib/ai/`). Lo único que vive acá es el
 * transporte: dedupe, debounce, autorización del número y envío.
 *
 * Las tres piezas que importan, y por qué:
 *
 *  1. DEDUPE. Meta reintenta el webhook si no recibe el 200 a tiempo. El
 *     `message.id` es la PK de `wa_mensajes`, así que un reintento no inserta
 *     nada y el agente no contesta dos veces.
 *
 *  2. DEBOUNCE. La gente escribe de a tres mensajitos ("hola" / "me mandas" /
 *     "2 quesos"). Sin esperar, el bot contesta tres veces y además contesta a
 *     frases incompletas. Cada entrante reprograma el timer a +4s y al disparar
 *     se contesta a todo junto. El timer vive en memoria porque el API es un
 *     proceso de larga vida (igual que los crons de `plugins/*_cron.ts`); el
 *     `pendiente_desde` en la tabla es lo que hace que un reinicio no deje un
 *     mensaje sin respuesta para siempre.
 *
 *  3. AUTORIZACIÓN. El agente solo razona con números marcados
 *     `wa_contactos.autorizado` — hoy, los de adentro del negocio. A un número
 *     desconocido le contesta UNA línea fija, sin LLM: es lo que evita que un
 *     número equivocado queme la cuota diaria de Groq, y deja el conteo de
 *     mensajes para que el negocio decida a quién habilitar.
 */

import type { FastifyInstance } from 'fastify'
import type Groq from 'groq-sdk'
import type { PoolClient } from 'pg'

import { AI_MODEL, isRateLimit, type AiClient } from '../ai/client.js'
import { cargarContextoNegocio, cargarCategoriasGasto } from '../ai/contexto.js'
import { executeTool } from '../ai/executor.js'
import { buildSystemPrompt } from '../ai/prompts.js'
import { getToolsForContext } from '../ai/tools.js'
import { abrirConexionDeTenant, cerrarConexionDeTenant } from '../../middleware/tenant-resolver.js'
import { enviarTextoWhatsapp } from './client.js'
import { leerCambios, textoDelMensaje, type MetaCambio, type MetaMensaje } from './webhook.js'

/** Lo que se espera a que la persona termine de escribir antes de contestar. */
const DEBOUNCE_MS = 4_000

/** Cuántos mensajes de la conversación se le pasan al LLM. Igual que /ai/chat. */
const HISTORIAL = 12

/** Vueltas máximas del loop de tool calls — corta ciclos infinitos. */
const MAX_VUELTAS_TOOLS = 5

/**
 * Cuánto se reserva la conversación mientras se la procesa. Es un timestamp y
 * no un boolean para que un proceso que muere a mitad no deje la conversación
 * muda para siempre: al expirar, el siguiente mensaje la vuelve a tomar.
 */
const LOCK_MINUTOS = 2

const RESPUESTA_NO_AUTORIZADO =
  'Hola, gracias por escribir. Este número lo atiende una persona del negocio — ya le quedó tu mensaje y te responde en el día.'

interface TenantDestino {
  id: string
  name: string
  slug: string
  schemaName: string
}

export interface AgenteWhatsapp {
  /** Procesa un POST del webhook ya validado. No lanza: loguea y sigue. */
  procesarPayload: (body: unknown) => Promise<void>
}

export function crearAgenteWhatsapp(
  fastify: FastifyInstance,
  aiClient: AiClient,
): AgenteWhatsapp {
  const { WHATSAPP_TOKEN, GRAPH_API_VERSION } = fastify.config

  /**
   * Timers del debounce, uno por conversación (`schema:wa_id`). En memoria a
   * propósito; ver la nota 2 del encabezado.
   */
  const timers = new Map<string, NodeJS.Timeout>()

  function programar(tenant: TenantDestino, phoneNumberId: string, waId: string): void {
    const clave = `${tenant.schemaName}:${waId}`
    const previo = timers.get(clave)
    if (previo) clearTimeout(previo)

    timers.set(
      clave,
      setTimeout(() => {
        timers.delete(clave)
        void responder(tenant, phoneNumberId, waId).catch((err) => {
          fastify.log.error({ err, tenant: tenant.slug, waId }, 'whatsapp: error al responder')
        })
      }, DEBOUNCE_MS),
    )
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Entrada: guardar lo que llegó
  // ───────────────────────────────────────────────────────────────────────────

  async function procesarPayload(body: unknown): Promise<void> {
    for (const cambio of leerCambios(body)) {
      try {
        await procesarCambio(cambio)
      } catch (err) {
        fastify.log.error(
          { err, phoneNumberId: cambio.phoneNumberId },
          'whatsapp: error procesando cambio',
        )
      }
    }
  }

  async function procesarCambio(cambio: MetaCambio): Promise<void> {
    // El webhook no trae subdominio ni sesión: el `phone_number_id` del número
    // que RECIBIÓ el mensaje es lo único que dice de qué empresa es este chat.
    const numero = await fastify.prisma.tenantWhatsappNumber.findFirst({
      where: { phoneNumberId: cambio.phoneNumberId, activo: true },
      include: { tenant: true },
    })

    if (!numero || numero.tenant.status !== 'active') {
      // Pasa de verdad: la app de dev y la de prod pueden quedar apuntando al
      // mismo número, o alguien desactiva el canal sin desuscribir el webhook.
      fastify.log.warn(
        { phoneNumberId: cambio.phoneNumberId },
        'whatsapp: mensaje para un número sin tenant activo — descartado',
      )
      return
    }

    const tenant: TenantDestino = {
      id: numero.tenant.id,
      name: numero.tenant.name,
      slug: numero.tenant.slug,
      schemaName: numero.tenant.schemaName,
    }

    const db = await abrirConexionDeTenant(fastify, tenant.schemaName)
    const aContestar = new Set<string>()
    const aRechazar = new Set<string>()

    try {
      for (const mensaje of cambio.mensajes) {
        const waId = mensaje.from
        const perfil = cambio.contactos.find((c) => c.wa_id === waId)?.profile?.name ?? null

        const esNuevo = await guardarEntrante(db, mensaje, perfil)
        if (!esNuevo) {
          // Reintento de Meta sobre un mensaje ya procesado.
          fastify.log.debug({ id: mensaje.id }, 'whatsapp: mensaje duplicado, ignorado')
          continue
        }

        const estado = await estadoDeConversacion(db, waId)
        if (estado.autorizado && estado.estado === 'bot') aContestar.add(waId)
        else if (!estado.autorizado) aRechazar.add(waId)
        // `estado === 'humano'`: alguien del negocio tomó el chat. Se guarda el
        // mensaje y el bot se queda callado, que es el punto de ese estado.
      }
    } finally {
      await cerrarConexionDeTenant(db)
    }

    for (const waId of aContestar) programar(tenant, cambio.phoneNumberId, waId)
    for (const waId of aRechazar) {
      await responderNoAutorizado(tenant, cambio.phoneNumberId, waId).catch((err) => {
        fastify.log.error({ err, waId }, 'whatsapp: no se pudo avisar al número no autorizado')
      })
    }
  }

  /**
   * Guarda contacto + mensaje + estado de conversación. Devuelve false si el
   * mensaje ya estaba (reintento de Meta): ese false ES el dedupe.
   *
   * Todo en una transacción para que un mensaje nunca quede guardado sin su
   * contacto (hay FK) ni marcado como pendiente sin estar guardado.
   */
  async function guardarEntrante(
    db: PoolClient,
    mensaje: MetaMensaje,
    perfil: string | null,
  ): Promise<boolean> {
    const waId = mensaje.from
    const texto = textoDelMensaje(mensaje)

    await db.query('BEGIN')
    try {
      await db.query(
        `INSERT INTO wa_contactos (wa_id, profile_name)
         VALUES ($1, $2)
         ON CONFLICT (wa_id) DO UPDATE
           SET profile_name = COALESCE(EXCLUDED.profile_name, wa_contactos.profile_name),
               ultimo_mensaje_at = NOW()`,
        [waId, perfil],
      )

      const insertado = await db.query(
        `INSERT INTO wa_mensajes (id, wa_id, direccion, tipo, cuerpo, raw)
         VALUES ($1, $2, 'entrante', $3, $4, $5)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [mensaje.id, waId, mensaje.type, texto, JSON.stringify(mensaje)],
      )

      if (insertado.rowCount === 0) {
        await db.query('ROLLBACK')
        return false
      }

      await db.query(
        `INSERT INTO wa_conversaciones (wa_id, ventana_expira_at, pendiente_desde)
         VALUES ($1, NOW() + INTERVAL '24 hours', NOW())
         ON CONFLICT (wa_id) DO UPDATE
           SET ventana_expira_at = NOW() + INTERVAL '24 hours',
               -- COALESCE: el primero de la ráfaga marca desde cuándo hay algo
               -- pendiente; los siguientes no mueven esa marca.
               pendiente_desde = COALESCE(wa_conversaciones.pendiente_desde, NOW()),
               updated_at = NOW()`,
        [waId],
      )

      await db.query('COMMIT')
      return true
    } catch (error) {
      await db.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  async function estadoDeConversacion(
    db: PoolClient,
    waId: string,
  ): Promise<{ autorizado: boolean; estado: string }> {
    const res = await db.query<{ autorizado: boolean; estado: string | null }>(
      `SELECT c.autorizado, conv.estado
       FROM wa_contactos c
       LEFT JOIN wa_conversaciones conv ON conv.wa_id = c.wa_id
       WHERE c.wa_id = $1`,
      [waId],
    )
    const fila = res.rows[0]
    return { autorizado: fila?.autorizado ?? false, estado: fila?.estado ?? 'bot' }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Salida: contestar
  // ───────────────────────────────────────────────────────────────────────────

  async function responder(
    tenant: TenantDestino,
    phoneNumberId: string,
    waId: string,
  ): Promise<void> {
    const db = await abrirConexionDeTenant(fastify, tenant.schemaName)
    try {
      // Reserva. Si el UPDATE no toma ninguna fila, otra instancia (o el timer
      // anterior) ya está contestando este chat: salir sin escribir nada.
      const tomada = await db.query(
        `UPDATE wa_conversaciones
            SET procesando_hasta = NOW() + INTERVAL '${LOCK_MINUTOS} minutes',
                pendiente_desde  = NULL,
                updated_at       = NOW()
          WHERE wa_id = $1
            AND estado = 'bot'
            AND (procesando_hasta IS NULL OR procesando_hasta < NOW())
          RETURNING wa_id`,
        [waId],
      )
      if (tomada.rowCount === 0) return

      const contacto = await db.query<{ usuario_id: string | null; autorizado: boolean }>(
        'SELECT usuario_id, autorizado FROM wa_contactos WHERE wa_id = $1',
        [waId],
      )
      if (!contacto.rows[0]?.autorizado) return

      // La auditoría (migración 019) lee este GUC para saber quién hizo cada
      // cambio. Sin esto, todo lo que el agente haga por WhatsApp queda
      // registrado sin autor — y el punto de la auditoría es justamente que
      // cada movimiento tenga uno.
      await db.query(`SELECT set_config('app.current_user_id', $1, false)`, [
        contacto.rows[0].usuario_id ?? '',
      ])

      const texto = await generarRespuesta(db, tenant, waId)
      if (!texto) return

      await enviarYGuardar(db, { phoneNumberId, waId, texto })

      // ¿Entró algo nuevo mientras se generaba la respuesta? Entonces hay otra
      // ráfaga esperando: se reprograma en vez de dejarla sin contestar.
      const quedoPendiente = await db.query<{ pendiente_desde: Date | null }>(
        'SELECT pendiente_desde FROM wa_conversaciones WHERE wa_id = $1',
        [waId],
      )
      if (quedoPendiente.rows[0]?.pendiente_desde) {
        programar(tenant, phoneNumberId, waId)
      }
    } finally {
      await db
        .query(
          `UPDATE wa_conversaciones SET procesando_hasta = NULL, updated_at = NOW() WHERE wa_id = $1`,
          [waId],
        )
        .catch(() => undefined)
      await cerrarConexionDeTenant(db)
    }
  }

  /** Corre el agente sobre el historial de la conversación. */
  async function generarRespuesta(
    db: PoolClient,
    tenant: TenantDestino,
    waId: string,
  ): Promise<string | null> {
    const historial = await db.query<{ direccion: string; cuerpo: string | null; tipo: string }>(
      `SELECT direccion, cuerpo, tipo
         FROM wa_mensajes
        WHERE wa_id = $1
        ORDER BY created_at DESC
        LIMIT ${HISTORIAL}`,
      [waId],
    )

    const mensajes: Groq.Chat.ChatCompletionMessageParam[] = historial.rows
      .reverse()
      .map((fila) => ({
        role: fila.direccion === 'entrante' ? ('user' as const) : ('assistant' as const),
        // Un tipo que no sabemos leer (nota de voz, foto) llega sin cuerpo. Se
        // le dice al LLM qué fue, para que pueda pedir que lo escriban en vez
        // de contestar al vacío.
        content: fila.cuerpo ?? `[el usuario envió un mensaje de tipo ${fila.tipo}]`,
      }))

    if (mensajes.length === 0) return null

    const biz = await cargarContextoNegocio(db, tenant.name ?? tenant.slug, 'whatsapp', fastify.log)
    // Las categorías van al esquema de registrar_gasto como enum cerrado, así
    // que el modelo solo puede elegir una de las que el negocio tiene activas.
    const categoriasGasto = await cargarCategoriasGasto(db, fastify.log)
    const tools = getToolsForContext('whatsapp', { categoriasGasto })

    const conversacion: Groq.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: `${buildSystemPrompt(biz)}\n\n${REGLAS_CANAL}` },
      ...mensajes,
    ]

    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS_TOOLS; vuelta++) {
        const completion = await aiClient.chat({
          model: AI_MODEL,
          messages: conversacion,
          tools,
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 512,
        })

        const msg = completion.choices[0]?.message
        if (!msg) return null

        if (!msg.tool_calls?.length) return msg.content?.trim() || null

        conversacion.push(msg)

        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>
          } catch {
            // El LLM mandó argumentos que no son JSON. Se le devuelve el error
            // como resultado de la tool para que lo corrija en la vuelta
            // siguiente, en vez de tumbar la respuesta entera.
            conversacion.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ error: 'argumentos inválidos' }),
            })
            continue
          }

          fastify.log.info(
            { tenant: tenant.slug, waId, tool: tc.function.name, args },
            'whatsapp: tool_call',
          )

          const resultado = await executeTool(tc.function.name, args, db)
          conversacion.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(resultado.success ? resultado.data : { error: resultado.error }),
          })
        }
      }

      // Se agotaron las vueltas con tools: una última pasada sin ellas para que
      // cierre en lenguaje natural lo que ya hizo.
      const cierre = await aiClient.chat({
        model: AI_MODEL,
        messages: conversacion,
        temperature: 0.3,
        max_tokens: 256,
      })
      return cierre.choices[0]?.message?.content?.trim() || 'Listo.'
    } catch (err) {
      fastify.log.error({ err, tenant: tenant.slug }, 'whatsapp: error del agente')
      // "en un minuto" y no "por hoy": el límite de Groq que se toca en la
      // práctica es de tokens por MINUTO, no un cupo diario. Decir "hoy" hacía
      // que el dueño dejara de intentar cuando bastaba con reenviar.
      return isRateLimit(err)
        ? '⏳ Me quedé sin cupo del modelo. Reenviá el mensaje en un minuto.'
        : '⚠ No pude procesar eso. Intentá de nuevo.'
    }
  }

  /**
   * Una línea fija para números sin autorizar, como máximo una por día.
   *
   * Sin el tope, dos desconocidos con un número equivocado se pueden mandar
   * mensajes toda la tarde y el negocio paga el ruido (y la cuota de Meta si
   * la ventana se cierra). Con tope, el negocio igual ve la conversación
   * guardada y decide si autoriza ese número.
   */
  async function responderNoAutorizado(
    tenant: TenantDestino,
    phoneNumberId: string,
    waId: string,
  ): Promise<void> {
    const db = await abrirConexionDeTenant(fastify, tenant.schemaName)
    try {
      // El agente no va a contestar este chat, así que no hay nada pendiente:
      // dejar la marca puesta mentiría sobre el estado de la conversación (y
      // el índice parcial de `pendiente_desde` existe justo para encontrar las
      // que sí esperan respuesta).
      await db.query(
        `UPDATE wa_conversaciones SET pendiente_desde = NULL, updated_at = NOW() WHERE wa_id = $1`,
        [waId],
      )

      const yaAvisado = await db.query(
        `SELECT 1 FROM wa_mensajes
          WHERE wa_id = $1 AND direccion = 'saliente'
            AND created_at > NOW() - INTERVAL '24 hours'
          LIMIT 1`,
        [waId],
      )
      if (yaAvisado.rowCount && yaAvisado.rowCount > 0) return

      await enviarYGuardar(db, { phoneNumberId, waId, texto: RESPUESTA_NO_AUTORIZADO })
    } finally {
      await cerrarConexionDeTenant(db)
    }
  }

  /** Manda por Graph y guarda el saliente con el id que devuelve Meta. */
  async function enviarYGuardar(
    db: PoolClient,
    envio: { phoneNumberId: string; waId: string; texto: string },
  ): Promise<void> {
    const id = await enviarTextoWhatsapp({
      token: WHATSAPP_TOKEN,
      phoneNumberId: envio.phoneNumberId,
      graphVersion: GRAPH_API_VERSION,
      to: envio.waId,
      texto: envio.texto,
    })

    await db.query(
      `INSERT INTO wa_mensajes (id, wa_id, direccion, tipo, cuerpo)
       VALUES ($1, $2, 'saliente', 'text', $3)
       ON CONFLICT (id) DO NOTHING`,
      // Si Graph no devolvió id (no debería pasar), se sintetiza uno local para
      // no perder el mensaje del historial — la PK no admite null.
      [id ?? `local-${Date.now()}-${envio.waId}`, envio.waId, envio.texto],
    )
  }

  return { procesarPayload }
}

/**
 * Lo que cambia por ser WhatsApp y no el chat de la app. El system prompt
 * grande (rol, datos del negocio, cascadas entre módulos, orden obligatorio
 * para registrar una venta) es el mismo de `/ai/chat` — acá solo se agrega lo
 * propio del canal.
 */
export const REGLAS_CANAL = `## Estás contestando por WhatsApp
- Respondés a la dueña o a alguien del negocio, desde su celular.
- Máximo 2 o 3 líneas. Sin markdown, sin listas largas, sin títulos.
- Si te mandan una nota de voz o una foto, decí que por ahora solo podés leer texto.
- Si falta un dato para registrar algo, preguntá SOLO ese dato en una línea. Si sale de una lista corta (la categoría, el medio de pago), ofrecé las opciones ahí mismo.
- Nunca completes un dato a dedo para ahorrarte la pregunta. Vale más un mensaje extra que un registro mal clasificado.
- Después de registrar algo, confirmalo en una frase corta con el número o total. En un gasto decí con qué categoría quedó; en un abono, a qué factura se aplicó y cuánto le falta.`
