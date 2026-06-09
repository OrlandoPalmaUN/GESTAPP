# Antigravity — Plan de desarrollo

> SaaS multitenant de gestión operativa para PYMEs colombianas.  
> Reemplaza el Excel operativo con módulos de inventario, finanzas, pedidos, clientes y más.  
> Mercado inicial: Colombia. Modelo: suscripción mensual. Arquitectura: schema-por-tenant en PostgreSQL.

---

## Índice

1. [Visión y posicionamiento](#1-visión-y-posicionamiento)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura del sistema](#3-arquitectura-del-sistema)
4. [Modelo multitenant](#4-modelo-multitenant)
5. [Módulos — lógica y reglas de negocio](#5-módulos--lógica-y-reglas-de-negocio)
6. [Integraciones](#6-integraciones)
7. [Modelo de suscripción](#7-modelo-de-suscripción)
8. [Roadmap de desarrollo](#8-roadmap-de-desarrollo)
9. [Schema de base de datos — tablas maestras](#9-schema-de-base-de-datos--tablas-maestras)
10. [Decisiones técnicas críticas](#10-decisiones-técnicas-críticas)
11. [Qué NO hacer en bootstrap](#11-qué-no-hacer-en-bootstrap)

---

## 1. Visión y posicionamiento

**Problema:** Las PYMEs colombianas operan con Excel compartido por WhatsApp. Versiones duplicadas, sin control de acceso, sin trazabilidad, sin alertas. Cuando el negocio crece, el Excel colapsa.

**Solución:** Antigravity es la primera herramienta de gestión que cualquier administrador de negocio entiende en 15 minutos. No es un ERP — es el Excel inteligente que ya debería existir.

**Diferenciadores clave:**
- Onboarding en menos de 10 minutos (importación masiva desde Excel existente)
- Integración nativa con WhatsApp Business para notificaciones operativas
- Configuración por tipo de negocio (una tienda de ropa no ve los mismos campos que una distribuidora)
- Precio accesible para el mercado colombiano (desde COP $79.000/mes)
- Multiempresa desde el día 1 (un contador puede gestionar varios clientes)

**Público objetivo:** Comercio retail, distribución, y negocios de servicios con 1–200 empleados en Colombia. Ampliable a Latinoamérica en V2.

---

## 2. Stack tecnológico

### Frontend
| Tecnología | Versión | Propósito |
|---|---|---|
| Next.js | 14 (App Router) | Framework principal — SSR + Client Components |
| React | 18 | UI |
| TypeScript | 5+ | Tipado obligatorio desde día 1 |
| Tailwind CSS | 3 | Estilos utilitarios |
| shadcn/ui | latest | Componentes accesibles sin diseñar desde cero |
| React Query (TanStack) | v5 | Estado del servidor, caché, revalidación, optimistic updates |
| React Hook Form + Zod | latest | Formularios con validación compartida frontend/backend |
| Recharts | latest | Gráficas del dashboard |

### Backend
| Tecnología | Versión | Propósito |
|---|---|---|
| Node.js | 20 LTS | Runtime |
| Fastify | 4 | Framework HTTP — más rápido que Express, mejor DX que NestJS para equipo pequeño |
| TypeScript | 5+ | Tipado obligatorio |
| Prisma | 5 | ORM para schema público (tenants, billing, usuarios globales) |
| Kysely | latest | Query builder tipado para schemas de tenant (Prisma no maneja schema dinámico limpiamente) |
| node-postgres (pg) | latest | Driver base de datos |
| BullMQ | latest | Colas de jobs asíncronos |
| Zod | latest | Validación de input compartida con frontend |

### Infraestructura y datos
| Tecnología | Propósito |
|---|---|
| PostgreSQL 15 | Base de datos principal — schema por tenant |
| Redis 7 | Caché de sesiones, datos frecuentes, colas BullMQ |
| Railway / Render | Hosting bootstrap — Postgres + Redis gestionados, deploy desde GitHub |
| GitHub Actions | CI/CD — lint, tests, deploy automático |
| AWS S3 / Cloudflare R2 | Almacenamiento de archivos (importaciones Excel, documentos) |
| Resend | Email transaccional |

### Herramientas de desarrollo
```
monorepo: Turborepo
linter: ESLint + Prettier
testing: Vitest (unit) + Playwright (e2e)
migrations: scripts custom de tenant migration runner
```

---

## 3. Arquitectura del sistema

```
┌─────────────────────────────────────────────────────┐
│         Frontend — Next.js 14 (App Router)          │
│   SSR para dashboard público · Client para ops      │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────┐
│              API Gateway — Fastify                   │
│   Auth JWT · Tenant Resolver · Rate Limit · Logs    │
└──┬───────────┬──────────────┬───────────────────┬───┘
   │           │              │                   │
┌──▼──┐  ┌────▼────┐  ┌──────▼──────┐  ┌────────▼───┐
│Inv. │  │Pedidos  │  │  Finanzas   │  │CRM & Docs  │
│Stock│  │Envíos   │  │CxP·CxC·Bank │  │Clientes    │
└──┬──┘  └────┬────┘  └──────┬──────┘  └────────┬───┘
   └──────────┴──────────────┴──────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              PostgreSQL multitenant                  │
│   Schema por tenant · Prisma (public) · Kysely      │
│   Redis caché · BullMQ jobs background              │
└──────────────────────┬──────────────────────────────┘
                       │
      ┌────────────────┼────────────────┐
      │                │                │
┌─────▼──────┐  ┌──────▼──────┐  ┌─────▼──────┐
│ WhatsApp   │  │ Excel I/O   │  │   Email    │
│ Business   │  │ SheetJS     │  │   Resend   │
└────────────┘  └─────────────┘  └────────────┘
```

### Estructura del monorepo

```
antigravity/
├── apps/
│   ├── web/          # Next.js 14 — frontend principal
│   └── api/          # Fastify — API backend
├── packages/
│   ├── db/           # Prisma schema + migrations + Kysely types
│   ├── shared/       # Tipos TypeScript compartidos, schemas Zod
│   ├── ui/           # Componentes shadcn/ui personalizados
│   └── config/       # ESLint, TypeScript, Tailwind configs
├── scripts/
│   └── migrate-tenants.ts  # Runner de migraciones por tenant
├── turbo.json
└── package.json
```

---

## 4. Modelo multitenant

### Estrategia: schema por tenant en PostgreSQL

Cada empresa (tenant) obtiene su propio schema de Postgres:

```sql
-- Schema público (compartido)
public.tenants
public.subscription_plans
public.billing_events

-- Schema por tenant (ejemplo)
empresa_xyz.productos
empresa_xyz.movimientos_inventario
empresa_xyz.pedidos
empresa_xyz.clientes
-- etc.
```

**Ventajas:**
- Aislamiento real de datos — una brecha de seguridad en un tenant no compromete a otros
- Migraciones independientes por tenant
- Backup y restore por empresa
- Cumplimiento de regulaciones de privacidad más sencillo

**Costo:** Complejidad en gestión de migraciones → resuelta con el migration runner.

### Tenant Resolver (middleware crítico)

Todo request pasa por este middleware antes de cualquier lógica de negocio:

```typescript
// apps/api/src/middleware/tenant-resolver.ts

export async function tenantResolver(request: FastifyRequest, reply: FastifyReply) {
  // 1. Extraer slug del subdominio
  const host = request.headers.host ?? ''
  const slug = host.split('.')[0] // "empresaxyz" de "empresaxyz.antigravity.co"

  // 2. Buscar en tabla maestra
  const tenant = await db
    .selectFrom('public.tenants')
    .where('slug', '=', slug)
    .where('status', '=', 'active')
    .selectAll()
    .executeTakeFirst()

  if (!tenant) {
    return reply.status(404).send({ error: 'Tenant not found' })
  }

  // 3. Setear search_path de Postgres para este request
  await request.db.query(`SET search_path TO "${tenant.schema_name}", public`)

  // 4. Adjuntar contexto al request
  request.tenant = tenant
}
```

### Creación de tenant (onboarding)

```typescript
async function createTenant(data: CreateTenantInput) {
  const schemaName = `tenant_${slugify(data.companyName)}_${nanoid(6)}`

  await db.transaction(async (trx) => {
    // 1. Insertar en tabla maestra
    const tenant = await trx
      .insertInto('public.tenants')
      .values({
        name: data.companyName,
        slug: data.slug,
        schema_name: schemaName,
        plan: 'basico',
        status: 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    // 2. Crear schema
    await trx.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)

    // 3. Aplicar todas las migraciones al nuevo schema
    await runMigrationsForSchema(schemaName, trx)

    // 4. Insertar datos semilla (categorías por defecto, etc.)
    await seedTenantData(schemaName, trx)

    return tenant
  })
}
```

### Migration Runner

```typescript
// scripts/migrate-tenants.ts
// Aplicar migraciones pendientes a TODOS los tenants activos

const tenants = await db
  .selectFrom('public.tenants')
  .where('status', '=', 'active')
  .select(['schema_name', 'slug'])
  .execute()

for (const tenant of tenants) {
  console.log(`Migrating ${tenant.slug}...`)
  await runMigrationsForSchema(tenant.schema_name)
}
```

**Regla:** Nunca editar el schema de un tenant manualmente. Todo cambio va como migración versionada.

---

## 5. Módulos — lógica y reglas de negocio

### 5.1 Inventario

**Principio fundamental:** El stock nunca se modifica directamente. Todo cambio es una transacción.

```typescript
// El stock disponible siempre es la suma de movimientos
type TipoMovimiento =
  | 'entrada_compra'      // Recepción de mercancía de proveedor
  | 'salida_venta'        // Venta despachada
  | 'salida_devolucion'   // Devolución a proveedor
  | 'entrada_devolucion'  // Devolución de cliente
  | 'ajuste_positivo'     // Corrección de inventario (diferencia física)
  | 'ajuste_negativo'     // Corrección de inventario (merma)
  | 'reserva'             // Pedido confirmado, aún no despachado
  | 'liberacion_reserva'  // Pedido cancelado, stock reservado liberado
```

**Query de stock disponible:**
```sql
SELECT
  p.id,
  p.nombre,
  p.sku,
  COALESCE(SUM(
    CASE
      WHEN m.tipo IN ('entrada_compra', 'entrada_devolucion', 'ajuste_positivo', 'liberacion_reserva')
        THEN m.cantidad
      WHEN m.tipo IN ('salida_venta', 'salida_devolucion', 'ajuste_negativo', 'reserva')
        THEN -m.cantidad
    END
  ), 0) AS stock_disponible
FROM productos p
LEFT JOIN movimientos_inventario m ON m.producto_id = p.id
GROUP BY p.id, p.nombre, p.sku;
```

**Alertas de stock mínimo:**
- Job de BullMQ ejecuta cada hora
- Compara stock_disponible vs producto.stock_minimo
- Si stock_disponible <= stock_minimo → crea alerta y notifica por WhatsApp/email
- La alerta no se repite hasta que el stock suba y vuelva a bajar

### 5.2 Pedidos y envíos

**Máquina de estados:**

```
borrador → confirmado → en_preparacion → despachado → entregado
              ↓                                              ↑
           cancelado ←─────────────────────────────── (solo si no entregado)
```

**Reglas de transición:**
```typescript
const transicionesValidas: Record<EstadoPedido, EstadoPedido[]> = {
  borrador:        ['confirmado', 'cancelado'],
  confirmado:      ['en_preparacion', 'cancelado'],
  en_preparacion:  ['despachado', 'cancelado'],
  despachado:      ['entregado', 'cancelado'],
  entregado:       [], // estado terminal
  cancelado:       [], // estado terminal
}

// Efectos secundarios por transición
const efectosPorTransicion: Record<string, () => Promise<void>> = {
  'borrador→confirmado':       () => reservarStock(pedido),
  'confirmado→cancelado':      () => liberarReservaStock(pedido),
  'en_preparacion→despachado': () => confirmarSalidaStock(pedido),
  'despachado→entregado':      () => marcarFacturaCobrable(pedido),
}
```

**Al confirmar un pedido:**
1. Validar que hay stock suficiente para cada ítem
2. Crear movimientos de tipo `reserva` para cada ítem
3. Cambiar estado a `confirmado`
4. Notificar al cliente por WhatsApp (si tiene número configurado)

**Al despachar:**
1. Cambiar movimientos de `reserva` a `salida_venta`
2. Generar número de guía (manual en MVP)
3. Notificar al cliente con info de despacho

### 5.3 Cuentas por pagar y cobrar

**Modelo de documento + abonos:**

```
El saldo pendiente = total_documento - SUM(abonos)
Nunca se edita el documento original.
Los errores se corrigen con notas crédito/débito.
```

```sql
-- Vista de CxC con saldo pendiente
CREATE VIEW cxc_con_saldo AS
SELECT
  f.id,
  f.numero,
  f.cliente_id,
  f.fecha_vencimiento,
  f.total,
  COALESCE(SUM(a.monto), 0) AS total_abonado,
  f.total - COALESCE(SUM(a.monto), 0) AS saldo_pendiente,
  CASE
    WHEN f.total - COALESCE(SUM(a.monto), 0) <= 0 THEN 'pagada'
    WHEN f.fecha_vencimiento < CURRENT_DATE THEN 'vencida'
    ELSE 'pendiente'
  END AS estado
FROM facturas_venta f
LEFT JOIN abonos a ON a.factura_id = f.id
GROUP BY f.id;
```

**Alertas de vencimiento:**
- Job diario (3:00 AM) revisa vencimientos
- Crea alertas para facturas con vencimiento en 7 días, 1 día, y el día del vencimiento
- Notifica por email al responsable de cartera

### 5.4 Bancos y conciliación

**Flujo de conciliación:**

```
1. Usuario importa extracto bancario (Excel)
2. Sistema extrae movimientos del extracto
3. Algoritmo de matching automático:
   - Match exacto: monto = monto AND fecha_extracto - fecha_sistema BETWEEN -2 AND 2 días
   - Match aproximado: monto = monto AND fecha cercana (propuesto, requiere confirmación)
4. Usuario revisa matches propuestos y confirma/corrige
5. Movimientos sin match quedan en "pendientes de conciliación"
```

```typescript
function matchMovimientos(
  extracto: MovimientoExtracto[],
  registrados: MovimientoBanco[]
): MatchResult[] {
  const matches: MatchResult[] = []

  for (const mov of extracto) {
    // Buscar match exacto primero
    const exacto = registrados.find(r =>
      r.monto === mov.monto &&
      Math.abs(differenceInDays(r.fecha, mov.fecha)) <= 2 &&
      !r.conciliado
    )

    if (exacto) {
      matches.push({ tipo: 'exacto', extracto: mov, registrado: exacto, confianza: 1.0 })
      continue
    }

    // Buscar match por monto (fecha más flexible)
    const porMonto = registrados.find(r =>
      r.monto === mov.monto &&
      Math.abs(differenceInDays(r.fecha, mov.fecha)) <= 7 &&
      !r.conciliado
    )

    if (porMonto) {
      matches.push({ tipo: 'aproximado', extracto: mov, registrado: porMonto, confianza: 0.7 })
    } else {
      matches.push({ tipo: 'sin_match', extracto: mov, registrado: null, confianza: 0 })
    }
  }

  return matches
}
```

### 5.5 Clientes y proveedores (CRM básico)

**Ficha de cliente incluye:**
- Datos básicos (nombre, NIT, contacto, dirección)
- Historial de pedidos (últimos 12 meses)
- Saldo pendiente en CxC
- Score de crédito: promedio de días de pago en últimos 6 meses
- Última interacción registrada

**Score de crédito simple:**
```sql
SELECT
  cliente_id,
  AVG(
    EXTRACT(DAY FROM (fecha_pago - fecha_vencimiento))
  ) AS dias_promedio_pago
FROM abonos a
JOIN facturas_venta f ON f.id = a.factura_id
WHERE f.fecha_emision > NOW() - INTERVAL '6 months'
  AND a.fecha >= f.fecha_vencimiento  -- Solo pagos tardíos
GROUP BY cliente_id;
-- Negativo = paga antes del vencimiento (excelente)
-- 0 = paga exacto (bueno)
-- Positivo = paga tarde (riesgo)
```

### 5.6 Reportes y dashboard

**Dashboard principal (tiempo real):**
- Ventas del día vs mismo día semana anterior
- Ventas del mes vs mes anterior
- Productos con stock crítico (≤ stock mínimo)
- CxC vencidas (monto total y cantidad)
- Flujo de caja proyectado a 30 días

**Flujo de caja proyectado:**
```typescript
// Proyección simple basada en CxP y CxC pendientes
function calcularFlujoCajaProyectado(diasAdelante: number) {
  const hoy = new Date()
  const fechaFin = addDays(hoy, diasAdelante)

  // Ingresos esperados: CxC pendientes con vencimiento en el rango
  const ingresosEsperados = cxcPendientes
    .filter(f => f.fechaVencimiento <= fechaFin)
    .reduce((sum, f) => sum + f.saldoPendiente, 0)

  // Egresos esperados: CxP pendientes con vencimiento en el rango
  const egresosEsperados = cxpPendientes
    .filter(f => f.fechaVencimiento <= fechaFin)
    .reduce((sum, f) => sum + f.saldoPendiente, 0)

  return {
    ingresosEsperados,
    egresosEsperados,
    flujaNeto: ingresosEsperados - egresosEsperados,
  }
}
```

**Reportes pesados (jobs asíncronos):**
- Estado de resultados (mensual/anual)
- Rotación de inventario por producto
- Antigüedad de cartera
- Compras por proveedor

Los reportes pesados se encolan en BullMQ, se generan en background, y se notifica al usuario cuando están listos (email + badge en la UI).

---

## 6. Integraciones

### 6.1 WhatsApp Business (Meta Cloud API)

**Scope MVP:** Solo notificaciones salientes (el sistema envía, no recibe).

**Setup:**
1. Crear cuenta de Meta Business Manager
2. Crear app en Meta for Developers con producto WhatsApp
3. Registrar número de teléfono
4. Crear y someter templates para aprobación (1-3 días)

**Templates necesarios en MVP:**
```
PEDIDO_CONFIRMADO: "Hola {{1}}, tu pedido #{{2}} ha sido confirmado. Total: ${{3}}."
PEDIDO_DESPACHADO: "Tu pedido #{{1}} fue despachado. Guía: {{2}}."
STOCK_CRITICO:     "Alerta: el producto {{1}} tiene solo {{2}} unidades en stock."
PAGO_VENCIDO:      "Recordatorio: la factura #{{1}} por ${{2}} venció hace {{3}} días."
```

**Implementación:**
```typescript
// packages/shared/src/whatsapp.ts
export async function enviarNotificacion(params: {
  telefono: string
  template: string
  variables: string[]
}) {
  const response = await fetch(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.telefono,
        type: 'template',
        template: {
          name: params.template,
          language: { code: 'es' },
          components: [{
            type: 'body',
            parameters: params.variables.map(v => ({ type: 'text', text: v })),
          }],
        },
      }),
    }
  )
  return response.json()
}
```

**Job en BullMQ:**
```typescript
// Cada notificación se encola, no se envía sincrónicamente
await whatsappQueue.add('pedido-confirmado', {
  telefono: cliente.telefono,
  template: 'PEDIDO_CONFIRMADO',
  variables: [cliente.nombre, pedido.numero, formatCOP(pedido.total)],
})
```

### 6.2 Importación desde Excel (SheetJS)

**Flujo completo:**

```
1. Usuario sube .xlsx → almacenado en S3/R2 temporalmente
2. Backend lee con SheetJS y extrae headers + primeras 5 filas
3. Sistema detecta mapeo sugerido por similitud de nombres de columna
4. Usuario confirma/corrige el mapeo en el frontend
5. Validación masiva:
   - Campos obligatorios presentes
   - Tipos de dato correctos (número, fecha, etc.)
   - Duplicados por SKU/NIT/etc.
6. Reporte de validación: registros válidos vs errores
7. Si hay errores: descargable como Excel con columna "Error"
8. Import progresivo: lotes de 100 con progreso via WebSocket
9. Al completar: resumen (X insertados, Y actualizados, Z errores)
```

**Mapeo inteligente (aprende del tenant):**
```typescript
// Guarda mapeos anteriores del tenant para pre-rellenar en futuras importaciones
type MappingCache = {
  [columnHeader: string]: string // "Ref. Producto" → "sku"
}
```

**Módulos con importación en MVP:**
- Productos / inventario (campos: nombre, sku, precio, stock inicial, categoría)
- Clientes (campos: nombre, NIT, email, teléfono, dirección)
- Proveedores (campos: nombre, NIT, contacto, email)
- Facturas pendientes iniciales (para migración de cartera existente)

---

## 7. Modelo de suscripción

### Planes

| | Básico | Profesional | Empresarial |
|---|---|---|---|
| Precio/mes | COP $79.000 | COP $189.000 | COP $390.000 |
| Usuarios | 2 | 10 | Ilimitados |
| Productos | 500 | Ilimitados | Ilimitados |
| Módulos | Inventario + Clientes | Todos | Todos |
| Bodegas | 1 | 1 | Múltiples |
| WhatsApp notif. | No | Sí | Sí |
| Soporte | Email | Email + Chat | Prioritario |

### Implementación bootstrap

**Meses 1-3 (manual):**
- Cobro por transferencia bancaria / Nequi / Daviplata
- Confirmación manual en panel de admin
- Factura PDF enviada por email

**Mes 4+ (automatizado):**
- Integrar Wompi (mejor para Colombia: soporta PSE, tarjetas, Nequi)
- Webhook de Wompi actualiza estado de suscripción automáticamente
- Stripe solo si se internacionaliza a otros países de Latam

### Límites por plan (enforced en API)
```typescript
const limitesPorPlan = {
  basico:       { usuarios: 2, productos: 500 },
  profesional:  { usuarios: 10, productos: Infinity },
  empresarial:  { usuarios: Infinity, productos: Infinity },
}

// Middleware que verifica límites antes de crear recursos
async function checkPlanLimits(req: FastifyRequest, resource: 'usuario' | 'producto') {
  const { plan } = req.tenant
  const limites = limitesPorPlan[plan]
  const actual = await contarRecursos(req.tenant.schema_name, resource)

  if (actual >= limites[`${resource}s`]) {
    throw new PlanLimitError(`Límite de ${resource}s alcanzado en tu plan ${plan}`)
  }
}
```

---

## 8. Roadmap de desarrollo

### Fase 0 — Fundamentos (semanas 1–4)
**Goal:** Todo corre, el skeleton está listo, se puede crear un tenant.

- [ ] Setup monorepo Turborepo con apps/web y apps/api
- [ ] Configuración TypeScript, ESLint, Prettier en todos los packages
- [ ] PostgreSQL — schema público con tabla `tenants`
- [ ] Sistema de auth: NextAuth con credenciales + magic link por email
- [ ] Tenant resolver middleware en Fastify
- [ ] Onboarding flow: registro de empresa → crea schema → redirige al dashboard
- [ ] Migration runner para schemas de tenant
- [ ] Dashboard vacío con layout principal (sidebar, header, breadcrumbs)
- [ ] Deploy básico en Railway

**Entregable:** Puedo registrar una empresa, iniciar sesión, y ver un dashboard vacío en `miempresa.antigravity.co`.

---

### Fase 1 — Inventario (semanas 5–8)
**Goal:** Un negocio puede gestionar su inventario completo. Primer módulo lanzable con piloto.

- [ ] CRUD de categorías
- [ ] CRUD de productos (nombre, SKU, precio costo, precio venta, unidad, categoría, stock mínimo)
- [ ] Motor de movimientos de inventario (entradas, salidas, ajustes)
- [ ] Vista de stock actual por producto
- [ ] Historial de movimientos por producto
- [ ] Importación masiva desde Excel (SheetJS) con mapeo de columnas
- [ ] Alertas de stock mínimo (job BullMQ + badge en dashboard)
- [ ] Búsqueda y filtros de productos

**Entregable:** Los primeros pilotos pueden cargar su inventario desde Excel y ver el stock en tiempo real.

---

### Fase 2 — Clientes y Pedidos (semanas 9–12)
**Goal:** Gestión del ciclo de venta.

- [ ] CRUD de clientes con ficha completa
- [ ] Importación de clientes desde Excel
- [ ] Creación de pedidos con ítems
- [ ] Máquina de estados de pedidos
- [ ] Conexión automática pedido ↔ inventario (reserva y descuento)
- [ ] Historial de pedidos por cliente
- [ ] Notificación WhatsApp al confirmar pedido
- [ ] Notificación WhatsApp al despachar pedido
- [ ] Lista de pedidos con filtros por estado y fecha

**Entregable:** Un comercio puede tomar pedidos, controlar el inventario automáticamente, y notificar a sus clientes.

---

### Fase 3 — Finanzas básicas (semanas 13–17)
**Goal:** Reemplazar el Excel de finanzas.

- [ ] Módulo de proveedores con CRUD e importación
- [ ] CxP: facturas de compra + abonos + alertas de vencimiento
- [ ] CxC: facturas de venta + abonos + alertas de vencimiento
- [ ] Módulo de bancos: cuentas + movimientos
- [ ] Conciliación bancaria (importación extracto Excel + matching automático)
- [ ] Dashboard financiero: CxC, CxP, flujo de caja proyectado
- [ ] Reporte de antigüedad de cartera (job asíncrono)
- [ ] Email transaccional para alertas de vencimiento

**Entregable:** Un negocio puede ver en tiempo real cuánto le deben, cuánto debe, y cuál es su flujo de caja proyectado.

---

### Fase 4 — Pulido y lanzamiento (semanas 18–20)
**Goal:** Producto listo para cobrarse.

- [ ] Mejoras UX basadas en feedback de pilotos
- [ ] Reportes exportables (PDF / Excel): estado de resultados, rotación inventario
- [ ] Sistema de notificaciones in-app (badge + listado)
- [ ] Administración de usuarios y roles por tenant
- [ ] Integración de billing con Wompi
- [ ] Panel de super-admin (Antigravity): gestión de tenants, métricas globales
- [ ] Documentación básica / onboarding tour
- [ ] Landing page pública

**Entregable:** Producto cobrable, con billing automatizado y onboarding autogestionado.

---

## 9. Schema de base de datos — tablas maestras

### Schema público (compartido entre todos los tenants)

```sql
-- Tenants (empresas registradas)
CREATE TABLE public.tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,          -- "miempresa" → miempresa.antigravity.co
  schema_name TEXT NOT NULL UNIQUE,          -- "tenant_miempresa_abc123"
  plan        TEXT NOT NULL DEFAULT 'basico', -- basico | profesional | empresarial
  status      TEXT NOT NULL DEFAULT 'active', -- active | suspended | cancelled
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ
);

-- Planes y precios
CREATE TABLE public.subscription_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  precio_cop      INTEGER NOT NULL,
  max_usuarios    INTEGER,      -- NULL = ilimitado
  max_productos   INTEGER,      -- NULL = ilimitado
  features        JSONB NOT NULL DEFAULT '{}'
);

-- Eventos de billing (historial de pagos)
CREATE TABLE public.billing_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id),
  tipo        TEXT NOT NULL,    -- pago | falla | cancelacion | upgrade
  monto_cop   INTEGER,
  referencia  TEXT,             -- ID de transacción Wompi
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla de migraciones por schema (para el migration runner)
CREATE TABLE public.migration_log (
  id          SERIAL PRIMARY KEY,
  schema_name TEXT NOT NULL,
  migration   TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(schema_name, migration)
);
```

### Schema por tenant (ejemplo de tablas core)

```sql
-- Usuarios del tenant
CREATE TABLE usuarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  rol         TEXT NOT NULL DEFAULT 'operador', -- admin | operador | solo_lectura
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Productos
CREATE TABLE productos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             TEXT UNIQUE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  categoria_id    UUID REFERENCES categorias(id),
  precio_costo    NUMERIC(12,2),
  precio_venta    NUMERIC(12,2),
  unidad          TEXT NOT NULL DEFAULT 'unidad',
  stock_minimo    NUMERIC(12,2) NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Movimientos de inventario (fuente de verdad del stock)
CREATE TABLE movimientos_inventario (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  tipo            TEXT NOT NULL,      -- entrada_compra | salida_venta | ajuste_positivo | etc.
  cantidad        NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2),
  referencia_tipo TEXT,               -- 'pedido' | 'factura_compra' | 'ajuste'
  referencia_id   UUID,               -- ID del documento de origen
  notas           TEXT,
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clientes
CREATE TABLE clientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  nit         TEXT UNIQUE,
  email       TEXT,
  telefono    TEXT,
  direccion   TEXT,
  ciudad      TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pedidos
CREATE TABLE pedidos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          TEXT NOT NULL UNIQUE,   -- Auto-generado: PED-2024-0001
  cliente_id      UUID REFERENCES clientes(id),
  estado          TEXT NOT NULL DEFAULT 'borrador',
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas           TEXT,
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ítems de pedido
CREATE TABLE pedido_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        NUMERIC(12,2) NOT NULL,
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);

-- Facturas de venta (CxC)
CREATE TABLE facturas_venta (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            TEXT NOT NULL UNIQUE,
  cliente_id        UUID REFERENCES clientes(id),
  pedido_id         UUID REFERENCES pedidos(id),
  fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,
  total             NUMERIC(12,2) NOT NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Abonos (tanto para CxC como CxP)
CREATE TABLE abonos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento  TEXT NOT NULL,    -- 'factura_venta' | 'factura_compra'
  documento_id    UUID NOT NULL,
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  medio_pago      TEXT,             -- efectivo | transferencia | cheque | tarjeta
  referencia      TEXT,             -- número de comprobante
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 10. Decisiones técnicas críticas

### Por qué schema-por-tenant y no tenant_id en columnas

| | Schema por tenant | tenant_id en tablas |
|---|---|---|
| Aislamiento de datos | Real (nivel Postgres) | Lógico (nivel app) |
| Riesgo de fuga de datos | Muy bajo | Medio (bug de WHERE podría exponer datos) |
| Complejidad de migraciones | Alta (requiere runner) | Baja |
| Performance en escala alta (10k+ tenants) | Media | Alta |
| Backup por tenant | Sencillo | Complejo |
| **Decisión para Antigravity** | ✅ Correcta para MVP–500 tenants | Considerar si se supera esa escala |

### Por qué Fastify y no Express/NestJS

- Fastify es ~2x más rápido que Express en throughput puro
- NestJS tiene demasiado boilerplate para un equipo de 1 persona en bootstrap
- Fastify tiene excelente soporte de TypeScript y sistema de plugins

### Por qué Kysely y no Prisma para queries de tenant

Prisma no tiene soporte nativo para cambiar el `search_path` de Postgres en runtime. Kysely permite construir queries tipadas con el schema correcto sin este problema. Prisma se mantiene solo para el schema público (tenants, billing) donde el schema es siempre `public`.

### Manejo de errores y observabilidad desde el día 1

```typescript
// No esperes a tener 100 usuarios para agregar logging estructurado
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
})

// Cada request loguea: tenant, usuario, duración, resultado
fastify.addHook('onResponse', async (request, reply) => {
  logger.info({
    tenant: request.tenant?.slug,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    responseTime: reply.getResponseTime(),
  })
})
```

---

## 11. Qué NO hacer en bootstrap

### ❌ Facturación electrónica DIAN
Complejo, requiere proveedor tecnológico habilitado (Siesa, Alegra API, etc.), tiempo de certificación. El 80% de tus primeros clientes no la necesitan para empezar. Agregar en V2 cuando un cliente la exija como condición de pago.

### ❌ App móvil nativa
Next.js con diseño responsive + PWA es suficiente para los casos móviles del MVP. Una app iOS/Android duplica el trabajo de desarrollo sin agregar valor real en esta etapa.

### ❌ Multi-bodega en V1
Es complejidad de inventario que triplica el esfuerzo del módulo. Un campo `ubicacion` de texto en el producto es suficiente para el primer año.

### ❌ API pública / webhooks en V1
Agrega superficie de ataque y deuda de documentación. Solo cuando un cliente de Empresarial lo exija explícitamente.

### ❌ Lanzar todos los módulos simultáneamente
Riesgo de no lanzar nunca. La estrategia correcta:
- Semana 8: acceso piloto a Inventario (solo)
- Semana 12: agregar Pedidos
- Semana 17: agregar Finanzas
- Semana 20: lanzamiento público con billing

El dinero real de los pilotos es el mejor validador de prioridades.

---

## Variables de entorno necesarias

```bash
# Base de datos
DATABASE_URL=postgresql://user:pass@host:5432/antigravity
REDIS_URL=redis://host:6379

# Auth
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://antigravity.co

# WhatsApp Business
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_ID=...

# Email
RESEND_API_KEY=...

# Storage (archivos)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET=antigravity-files

# App
APP_DOMAIN=antigravity.co
NODE_ENV=production
LOG_LEVEL=info
```

---

*Documento generado para Antigravity — v0.1 — actualizar con cada cambio de arquitectura.*
