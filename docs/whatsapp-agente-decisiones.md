# Agente de WhatsApp — decisiones resueltas contra el código

> Respuesta al documento de traspaso del research de WhatsApp Cloud API (23 nov 2026).
> Ese documento dejó seis decisiones abiertas y pidió que no se propusiera stack sin leerlo.
> Este documento cierra las que el código de Gestapp ya tiene resueltas, y marca las que
> siguen abiertas de verdad. Lo que cambia respecto al traspaso está marcado **CAMBIA**.

---

## 1. Qué es Gestapp (decisión §10.1) — resuelta

Gestapp (paquetes `@antigravity/*`) es un **SaaS multitenant de gestión operativa para PYMEs
colombianas**: inventario, pedidos, finanzas y CRM. Cada empresa vive en **su propio schema de
PostgreSQL** (`tenant_<slug>_<id>`), resuelto por subdominio. Next.js 14 + Fastify 5 + Postgres
(Prisma para `public`, Kysely para los schemas de tenant), Turborepo + pnpm.

Y lo más importante para este proyecto: **el agente de IA ya existe**.

| Ya construido | Dónde |
|---|---|
| Agente con tool use (26 herramientas) | `apps/api/src/lib/ai/tools.ts` |
| Executor que valida todo lo que viene del LLM | `apps/api/src/lib/ai/executor.ts` (1170 líneas) |
| System prompt enriquecido con datos reales del tenant | `apps/api/src/lib/ai/prompts.ts` |
| Cadena de fallback Groq → Gemini → Groq key 2 → 8b | `apps/api/src/lib/ai/client.ts` |
| Endpoint del chat | `apps/api/src/routes/tenant/ai_chat.ts` |
| Webhook público con HMAC + rawBody | `apps/api/src/routes/webhook_apify.ts`, `lib/apify/webhook.ts` |
| Crons dentro del server | `apps/api/src/plugins/*_cron.ts` |
| Links `wa.me` con mensaje armado (pedido, estado de cuenta) | `apps/web/lib/whatsapp.ts` |

Las herramientas ya cubren el negocio: `buscar_cliente`, `crear_cliente`, `crear_pedido`,
`actualizar_estado_pedido`, `registrar_abono`, `ajustar_stock`, `registrar_gasto`,
`consultar_facturas_vencidas`, `consultar_stock_bajo`… y el executor replica a mano los
efectos secundarios (stock, saldos, CxC/CxP) y las `TRANSICIONES_VALIDAS` para que el LLM no
se salte la atomicidad que protege a los endpoints HTTP. **Nunca borra**: eliminar es del usuario.

→ **El agente de WhatsApp no es un agente nuevo: es un canal nuevo para el agente que ya existe.**
Esto reencuadra el proyecto entero. Lo que hay que construir es el transporte (webhook, dedupe,
debounce, envío), no el cerebro.

### Las dos cosas que "agente de WhatsApp" puede significar

**(a) WhatsApp para el dueño del negocio.** La misma conversación de `/ai/chat`, pero desde el
celular y sin abrir la app: *"anotá 2 quesos costeños a doña Marta"*. Reusa executor y
herramientas tal cual. La autenticación es un número conocido mapeado a `public.usuarios`.

**(b) WhatsApp atendiendo a los clientes del negocio.** Los vecinos encargando lácteos. Prompt
distinto, herramientas recortadas, y nadie autenticado del otro lado.

**Recomendación: (a) primero.** No por valor — (b) vale más — sino porque (a) no tiene ninguna de
las preguntas difíciles: un solo número conocido, una persona que ya es usuaria, ningún
desconocido creando pedidos ni viendo precios, y las herramientas ya escritas. Sirve para probar
webhook, dedupe, debounce y envío con riesgo cero, y después (b) es solo un prompt y un
subconjunto de tools sobre el mismo transporte ya probado.

Para (b), cuando llegue: el bot **no confirma pedidos**. Crea `pedidos` en estado `borrador`
(opcionalmente con `campana_id`, migración 031) y el dueño confirma en la app. Así el pedido del
bot entra por el mismo flujo que ya existe y el estado `borrador` no descuenta stock ni crea CxC.
La migración 031 describe exactamente el dolor que (b) resuelve: *"la gente encarga por WhatsApp"*
y hoy el conteo por sabor se suma a mano, pedido por pedido.

---

## 2. Un número o uno por cliente (decisión §10.2) — resuelta, pero no como dice el traspaso

**Uno por tenant.** No es una preferencia: el cliente final le escribe al número *de la tienda*,
no a un número de Gestapp. Y el traspaso tiene razón en que retrofitearlo es caro.

**CAMBIA — no crear la tabla `tenants` que propone §7.** Ya existe `public.tenants` (Prisma:
`id`, `name`, `slug`, `schemaName`, `plan`, `status`). Una segunda tabla de tenants con
`phone_number_id` como PK duplicaría la fuente de verdad. Lo que falta es solo el mapeo:

```sql
-- public (Prisma), no en el schema de tenant: el webhook necesita resolverlo
-- ANTES de saber a qué schema apuntar.
tenant_whatsapp_numbers
  phone_number_id  TEXT PRIMARY KEY
  tenant_id        UUID REFERENCES tenants(id)
  waba_id          TEXT
  display_number   TEXT
  activo           BOOLEAN
```

El enrutamiento va por `entry[].changes[].value.metadata.phone_number_id`, igual que propone el
traspaso. Después de resolver el `tenant_id`, se reusa el camino que ya existe en
[`tenant-resolver.ts`](../apps/api/src/middleware/tenant-resolver.ts): conexión **dedicada** del
pool con `SET search_path` al schema del tenant, `RESET` garantizado al terminar. Hoy ese
middleware resuelve por subdominio; hace falta una segunda entrada que resuelva por
`phone_number_id`. Es el único cambio estructural que pide este proyecto.

**CAMBIA — el token no es por tenant.** §7 pone `token` en la tabla de tenants. Con una WABA de
Gestapp que aloja varios números, el token es de plataforma (un secreto, no una columna). Si en
cambio cada cliente trae su propia WABA (onboarding tipo tech provider), entonces sí hay token
por tenant y hay que cifrarlo — **esto no está verificado** y conviene no diseñarlo hasta que
haya un segundo tenant que lo necesite.

**CAMBIA — contacts/messages/conversations no van en una base global.** El invariante del producto
es que *un bug no puede filtrar datos entre empresas* (de ahí schema-por-tenant en vez de columna
`tenant_id`). Una sola base D1 con todas las conversaciones de todos los tenants rompe eso. Las
tres tablas van **en el schema de cada tenant**, como migración `032_whatsapp.sql`. Solo el mapeo
`phone_number_id → tenant` y el log de runs van en `public`, igual que `apify_scrape_runs`.

Y `conversations.summary` se solapa con el CRM: `clientes` ya tiene `telefono` (migración 001) y
hay historial de pedidos por cliente. El contacto de WhatsApp debería **resolverse contra
`clientes`** por teléfono normalizado (`normalizarTelefono` ya existe en `apps/web/lib/whatsapp.ts`
y hay que subirla a `@antigravity/shared`), no ser una tabla de contactos paralela.

---

## 3. Stack: el desvío grande

**CAMBIA — Cloudflare Workers + D1 + Durable Objects no aplica. El webhook va en el Fastify que ya existe.**

El traspaso eligió Workers por una sola razón técnica, y está bien argumentada: los Workers no
sobreviven entre requests, así que el debounce de 4 segundos ("el usuario manda 3 mensajitos y el
bot contesta una vez") necesita los `alarm()` de un Durable Object, y por eso descarta `setTimeout`.

Ese razonamiento es correcto **para un host serverless**. Gestapp no lo es: el API es un proceso
Fastify de larga vida, con `node-cron` corriendo dentro (`reportes_cron`, `ig_cron`). La premisa
que hacía necesario el DO no se cumple acá, y con ella se cae toda la cadena: sin Workers no hace
falta D1, y sin D1 no hace falta mover los datos fuera de Postgres.

Lo decisivo es dónde viven los datos. El valor del agente está en las 26 herramientas, y esas
herramientas son SQL contra el schema Postgres de cada tenant, en Neon. Desde un Worker con D1
(SQLite) no se pueden ejecutar: habría que o reescribirlas, o llamar al API de todos modos. Es
decir, el Worker termina siendo un proxy con un deploy, un secreto compartido y un salto de red
extra — que es costo sin beneficio, porque el beneficio que justificaba el Worker (el debounce)
se consigue gratis en un proceso que no muere.

**Lo que sí hay que conservar del traspaso**, que es casi todo:

- `GET /webhook` devolviendo `hub.challenge`; `POST` respondiendo **200 inmediato** y procesando
  después. Sin eso, Meta reintenta y llegan duplicados.
- **Validación HMAC-SHA256 obligatoria** con `APP_SECRET`. El patrón ya está escrito y probado en
  `lib/apify/webhook.ts` (`timingSafeEqual`, `rawBody`); es el mismo header con otro nombre
  (`X-Hub-Signature-256`).
- **Dedupe por `message.id`** como PRIMARY KEY. En Postgres funciona igual que en D1.
- **Debounce de 4s**: fila en `wa_pendientes` + timer en proceso. El timer en memoria es seguro
  acá (proceso único de larga vida); la fila en la tabla es lo que hace que un reinicio no pierda
  mensajes, y evita el caso de "dos instancias contestan lo mismo" si algún día hay más de una.
- `GRAPH_API_VERSION` fijada explícitamente.
- **Dos apps de Meta, dev y prod.** Una app = un webhook; no hay forma de apuntar la misma a
  localhost y a producción.
- Costo $0: se mantiene. Groq ya está en uso y no se agrega ningún servicio.

**Decisión §10.3 (modelo de Groq) — ya resuelta por el código**: `llama-3.3-70b-versatile`, con
fallback a `llama-3.1-8b-instant`. Y la cadena de `AiClient` es mejor que lo que planteaba el
traspaso: cuando Groq pega el rate limit, cae a **Gemini 2.0 Flash** (1500 req/día gratis, tool use
completo) y a una segunda key de Groq antes de degradar a modelo chico. Eso estira bastante el
límite de 1.000 req/día de Groq, que era el techo más bajo de todo el plan.

---

## 4. Las trampas que importan acá

**El número de la tía.** Es la peor trampa del traspaso y en este caso es peor todavía: su número
operativo es *el que los vecinos ya tienen*. Registrarlo en Cloud API borra el historial de la app
de WhatsApp Business y **no se puede volver atrás**. Arrancar con el número de prueba de Meta, sin
excepción. El flujo `wa.me` que ya existe (`apps/web/lib/whatsapp.ts`) sigue funcionando con su
número real mientras tanto — y conviene que siga existiendo: no cuesta nada y no manda nada sin
que un humano confirme.

**Feature por tenant, no global.** Igual que el tema `8bit` (migración 025), el canal de WhatsApp
se activa por empresa — no puede aparecerle a un tenant que no lo pidió. El plan ya lo contempla
en la tabla de planes (`WhatsApp notif.: No / Sí / Sí`) y hay `lib/limites-plan.ts` para colgarlo.

**Dónde está desplegado el API.** Pendiente de confirmar, y es la única cosa que puede invalidar la
recomendación de la sección 3: si el host duerme por inactividad, el cold start arruina el webhook
de Meta — es la objeción exacta que el traspaso le hizo al free tier de Render. Si el API duerme,
hay que moverlo a algo que no duerma (no meter un Worker adelante: eso tapa el síntoma y deja el
resto del request igual de lento).

---

## 5. Decisiones que siguen abiertas

| # | Decisión | Estado |
|---|---|---|
| §10.4 | Media (audio, imágenes) | Abierta. Las notas de voz son reales en este público; requiere bajar el archivo del endpoint de media con el token. Transcripción: Whisper en Groq o audio nativo en Gemini — sin evaluar. |
| §10.5 | Escalamiento a humano | Abierta, pero hay dónde apoyarse: `comunicaciones` ya tiene notas y eventos de calendario. El bot que no sabe debería crear una nota para el dueño y decirlo, no improvisar. |
| §10.6 | Verificación de negocio en Meta | Abierta. No hace falta para el número de prueba. |
| — | Cupo de 1.000 mensajes de servicio gratis por número | Sin resolver, igual que en el traspaso: los trackers lo reportan, la página de Meta no lo menciona. Verificar en el panel de facturación de la WABA cuando exista. |
| — | ¿El cliente final puede ver precios y stock? | Nueva, y es de negocio, no técnica. Define el prompt y las tools de (b). |

---

## 6. Estado: el transporte está construido

Los pasos 1–5 del plan ya están en el repo. El canal funciona punta a punta para
el caso (a) — la dueña le escribe al bot desde su celular — y no toca nada del
agente existente más que para reusarlo.

| Pieza | Archivo |
|---|---|
| Tablas del canal, en el schema de cada tenant | `packages/db/tenant-migrations/032_whatsapp.sql` |
| Mapeo `phone_number_id → tenant`, en `public` | `packages/db/prisma/schema.prisma` (`TenantWhatsappNumber`) + migración `20261123120000_add_tenant_whatsapp_numbers` |
| Firma HMAC y lectura del payload de Meta | `apps/api/src/lib/whatsapp/webhook.ts` |
| Envío por Graph API | `apps/api/src/lib/whatsapp/client.ts` |
| Dedupe, debounce, autorización y enchufe al agente | `apps/api/src/lib/whatsapp/agente.ts` |
| Endpoint (`GET` challenge + `POST` firmado) | `apps/api/src/routes/webhook_whatsapp.ts` |
| Conexión de tenant fuera de un request | `apps/api/src/middleware/tenant-resolver.ts` (`abrirConexionDeTenant`) |
| Contexto del negocio compartido con `/ai/chat` | `apps/api/src/lib/ai/contexto.ts` |
| Configuración por empresa | `apps/api/src/scripts/wa-configurar.ts` |
| Tests (sin base de datos) | `apps/api/src/test/whatsapp.test.ts` |

Decisiones que se tomaron al construir, y que el plan de arriba no fijaba:

- **No hay tabla `wa_pendientes`.** El debounce vive en `wa_conversaciones`
  (`pendiente_desde` + `procesando_hasta`): "hay mensajes sin contestar de este
  número" es un estado de la conversación, uno por número, y separarlo solo
  agregaba un JOIN. El `procesando_hasta` además hace de lock, para que dos
  instancias del API no contesten lo mismo.
- **El bot solo le contesta a números autorizados** (`wa_contactos.autorizado`).
  A un desconocido le manda una línea fija, sin LLM, y como máximo una por día.
  Es lo que impide que un número equivocado queme la cuota de Groq, y es el
  punto donde se enchufará el caso (b).
- **La auditoría queda con autor.** Antes de ejecutar herramientas se setea el
  GUC `app.current_user_id` con el `usuario_id` del contacto, así que lo que el
  agente haga por WhatsApp queda atribuido a una persona en la auditoría (019).
- **El contexto del negocio se extrajo de `/ai/chat`** a `lib/ai/contexto.ts`.
  Eran ~80 líneas de SQL con las reglas de cómo se calcula el stock y qué hace
  vencida a una factura; duplicarlas garantizaba que el agente contestara
  distinto según el canal.
- **Los webhooks no pasan por el resolver de subdominio.** Un webhook entra por
  el host del API, donde el primer label no es el slug de ninguna empresa: sin
  la salida temprana, el resolver buscaba un tenant llamado "api" y devolvía 404.

### Cómo ponerlo a andar

1. Variables en `.env` (ver `.env.example`): `WHATSAPP_TOKEN` (permanente, de
   System User), `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`. Sin las tres el
   canal se deshabilita solo y lo dice en el log.
2. Migración del schema público: `pnpm --filter @antigravity/db run migrate:dev`.
   Las del tenant (`032`) se aplican solas al arrancar el API.
3. Suscribir el webhook en el dashboard de Meta al campo `messages`, apuntando a
   `https://<host>/webhooks/whatsapp` con el mismo verify token. En dev, por
   `cloudflared`; recordar que hacen falta dos apps de Meta, dev y prod.
4. Asociar el número y autorizar el celular:
   ```bash
   cd apps/api
   pnpm tsx src/scripts/wa-configurar.ts numero <slug> <phone_number_id> [waba_id]
   pnpm tsx src/scripts/wa-configurar.ts autorizar <slug> <celular> <email_usuario>
   pnpm tsx src/scripts/wa-configurar.ts ver <slug>
   ```

### Lo que sigue

- Probar contra el número de prueba de Meta: es lo único que no se puede
  verificar sin credenciales, y ahí se ve si el debounce de 4s se siente bien.
- Caso (b), atender a clientes finales: prompt propio, subconjunto de tools y
  pedidos en `borrador`. El transporte ya está; es el `autorizado = false` el que
  hoy lo frena.
- Una pantalla para configurar el canal, si deja de alcanzar el script.
