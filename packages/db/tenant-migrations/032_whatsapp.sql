-- Migración 032 — canal de WhatsApp (Cloud API de Meta).
--
-- Estas tres tablas van en el schema del TENANT, no en una base global, y esa
-- es la decisión importante: el invariante del producto es que un bug no pueda
-- filtrar datos entre empresas (de ahí schema-por-tenant en vez de columna
-- `tenant_id`). Las conversaciones de WhatsApp son datos de negocio como los
-- pedidos — una base compartida con los chats de todas las empresas rompería
-- ese aislamiento justo donde más duele. Lo único que vive en `public` es el
-- mapeo `phone_number_id → tenant` (Prisma), porque el webhook necesita
-- resolverlo ANTES de saber a qué schema apuntar.
--
-- Qué NO está acá: una tabla de contactos paralela al CRM. `clientes` ya tiene
-- `telefono` (migración 001), así que `wa_contactos.cliente_id` resuelve el
-- contacto contra el CRM existente en vez de duplicarlo.

-- ── Contactos ───────────────────────────────────────────────────────────────
-- El `wa_id` es el número que manda Meta: E.164 sin "+" (ej. 573001234567).
CREATE TABLE IF NOT EXISTS wa_contactos (
  wa_id             TEXT PRIMARY KEY,
  profile_name      TEXT,
  -- Contacto resuelto contra el CRM. Nullable: un número que escribe por
  -- primera vez todavía no es cliente de nadie.
  cliente_id        UUID REFERENCES clientes(id),
  -- Usuario de la plataforma dueño de este número, cuando el número es de
  -- adentro del negocio (el caso "la dueña le escribe al bot desde su celular").
  -- Sin FK a propósito: los usuarios de plataforma viven en `public.usuarios`,
  -- fuera de este schema — mismo criterio que `campanas.usuario_id` (031) y que
  -- la migración 002, que quitó justamente una FK así.
  usuario_id        UUID,
  -- Interruptor de confianza. El bot SOLO contesta con IA a números
  -- autorizados; a los demás responde una línea fija y le avisa al negocio.
  -- Es lo que impide que un desconocido queme cuota de LLM, y el punto donde
  -- se enchufará la atención a clientes finales cuando se decida ese alcance.
  autorizado        BOOLEAN NOT NULL DEFAULT false,
  primer_mensaje_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_mensaje_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_contactos_cliente ON wa_contactos(cliente_id) WHERE cliente_id IS NOT NULL;

-- ── Mensajes ────────────────────────────────────────────────────────────────
-- La PK es el `message.id` que manda Meta: eso ES el dedupe. Meta reintenta el
-- webhook cuando no recibe el 200 a tiempo, y sin esto el bot contestaría dos
-- veces al mismo mensaje. Un `ON CONFLICT DO NOTHING` que no inserta nada es
-- la señal de "esto ya lo procesamos, salir".
--
-- Los mensajes salientes propios también se guardan, con el id que devuelve
-- Graph, para que el historial que se le pasa al LLM sea la conversación
-- completa y no solo lo que entró.
CREATE TABLE IF NOT EXISTS wa_mensajes (
  id          TEXT PRIMARY KEY,
  wa_id       TEXT NOT NULL REFERENCES wa_contactos(wa_id),
  direccion   TEXT NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  tipo        TEXT NOT NULL DEFAULT 'text',
  cuerpo      TEXT,
  -- Payload crudo de Meta. Se guarda completo porque los tipos que todavía no
  -- se manejan (audio, imagen, ubicación) llegan igual y sin esto se perderían
  -- sin dejar rastro de qué mandó la persona.
  raw         JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_mensajes_conversacion ON wa_mensajes(wa_id, created_at DESC);

-- ── Conversaciones ──────────────────────────────────────────────────────────
-- Esta tabla es también la cola del debounce, y por eso no hay una
-- `wa_pendientes` aparte: "hay mensajes sin contestar de este número" es
-- exactamente un estado de la conversación, uno por número, y separarlo en
-- otra tabla solo agregaba un JOIN.
--
-- El debounce existe porque la gente escribe en WhatsApp de a tres mensajitos:
-- sin él el bot contesta tres veces. Cada mensaje entrante empuja
-- `pendiente_desde` y reprograma el timer; al disparar se contesta a todo junto.
CREATE TABLE IF NOT EXISTS wa_conversaciones (
  wa_id             TEXT PRIMARY KEY REFERENCES wa_contactos(wa_id),
  -- 'bot'    → el agente contesta
  -- 'humano' → el agente se calló (escaló, o alguien del negocio tomó el chat)
  estado            TEXT NOT NULL DEFAULT 'bot' CHECK (estado IN ('bot', 'humano')),
  -- Ventana de servicio de 24h de Meta: fuera de ella un mensaje libre no se
  -- puede enviar (haría falta una plantilla, que sí cuesta). Se refresca con
  -- cada mensaje entrante.
  ventana_expira_at TIMESTAMPTZ,
  -- Debounce: NULL = nada pendiente.
  pendiente_desde   TIMESTAMPTZ,
  -- Lock de procesamiento. El timer vive en memoria del proceso, así que si
  -- algún día hay más de una instancia del API las dos recibirían el webhook y
  -- contestarían lo mismo. Quien logra el UPDATE condicional procesa; el otro
  -- se va. El timestamp (en vez de un boolean) hace que un proceso que muere a
  -- mitad no deje la conversación trabada para siempre.
  procesando_hasta  TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_conversaciones_pendientes
  ON wa_conversaciones(pendiente_desde) WHERE pendiente_desde IS NOT NULL;

-- Sin trigger de auditoría (019) a propósito: acá no se edita, se acumula
-- tráfico de chat. Auditar cada mensaje llenaría la tabla de auditoría de
-- ruido y taparía lo que esa tabla sí tiene que mostrar — quién tocó un
-- pedido, un precio o un pago.
