# Antigravity

SaaS multitenant de gestión operativa para PYMEs colombianas — reemplaza el
Excel con módulos de inventario, pedidos, finanzas y CRM. Cada empresa
(*tenant*) vive en su propio schema de PostgreSQL (`tenant_<slug>_<id>`),
resuelto por subdominio (`miempresa.antigravity.co`).

> Este repo se llama `GESTAPP`, pero los paquetes usan el scope `@antigravity/*`
> — así nombra el producto el [plan de desarrollo](docs/antigravity-plan.md)
> original (referencia obligada para entender el *por qué* de cada decisión
> de arquitectura). Si en algún punto se renombra el repo, es un find-replace
> de scope.

## Stack

- **Frontend:** Next.js 14 (App Router) + Tailwind + shadcn/ui
- **Backend:** Fastify 5 + Zod (validación de env y de payloads)
- **Datos:** PostgreSQL — Prisma para el schema `public` (tenants, planes,
  billing), Kysely para los schemas de tenant (ver "Por qué" más abajo)
- **Monorepo:** Turborepo + pnpm workspaces

## Estructura

```
GESTAPP/
├── apps/
│   ├── web/              # Next.js — shell mínimo, listo para recibir diseños
│   └── api/              # Fastify — tenant-resolver, health check
├── packages/
│   ├── db/               # Prisma (schema público) + Kysely (base de tenant)
│   ├── shared/           # Tipos TS + schemas Zod compartidos (Tenant, EstadoPedido, ...)
│   ├── ui/               # Vacío — para los componentes que diseñes en Claude
│   └── config/           # tsconfig y eslint compartidos
├── scripts/
│   └── migrate-tenants.ts  # Migration runner (estructura — ver "Qué falta")
└── .env.example
```

## Por qué *schema-por-tenant* y Prisma + Kysely

Cada tenant tiene su propio schema de Postgres en lugar de una columna
`tenant_id` — aísla datos de verdad (un bug no puede filtrar entre empresas) y
permite migrar/respaldar tenants individualmente. El costo es que Prisma no
soporta cambiar su `search_path` en runtime, así que se usa para lo único que
puede ver (`public`: tenants, planes, billing) y **Kysely** —con SQL tipado—
para las queries contra el schema de cada tenant, donde el
[`tenant-resolver`](apps/api/src/middleware/tenant-resolver.ts) ya dejó el
`search_path` de la conexión apuntando al schema correcto. Más detalle en los
comentarios de ese archivo y en `packages/db/src/kysely.ts`.

## Cómo correrlo

### 1. Requisitos

- Node ≥ 20, [pnpm](https://pnpm.io) (vía `corepack enable`)
- PostgreSQL accesible — local (Postgres.app, Homebrew, Docker) o gestionado
  (Railway, Supabase, Neon; cualquiera sirve para desarrollo)

### 2. Instalar y configurar

```bash
corepack enable
pnpm install

cp .env.example .env
# completar DATABASE_URL como mínimo — ver comentarios en .env.example
```

### 3. Generar el cliente de Prisma

```bash
pnpm --filter @antigravity/db generate
```

### 4. Crear las tablas del schema público

Con `DATABASE_URL` apuntando a una base vacía:

```bash
pnpm --filter @antigravity/db run migrate:dev -- --name init
```

Esto crea `tenants`, `subscription_plans`, `billing_events` y `migration_log`
(plan §9). Las tablas de cada tenant las gestiona el migration runner —
ver "Qué falta" abajo.

### 5. Levantar todo en desarrollo

```bash
pnpm dev
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:4000/health](http://localhost:4000/health) → `{ "status": "ok", ... }`

## Scripts

Desde la raíz (orquestados por Turborepo):

| Script | Qué hace |
|---|---|
| `pnpm dev` | Levanta `web` y `api` en modo desarrollo |
| `pnpm build` | Compila todos los paquetes y apps |
| `pnpm lint` | ESLint en todo el monorepo |
| `pnpm type-check` | `tsc --noEmit` en todo el monorepo |
| `pnpm format` | Prettier sobre `.ts`/`.tsx`/`.md`/`.json` |
| `pnpm migrate:tenants` | Corre el migration runner (ver "Qué falta") |

También se puede apuntar a un paquete puntual: `pnpm --filter @antigravity/api dev`.

## Qué falta (a propósito)

Este bootstrap deja la arquitectura de base lista — instala, compila y corre
— pero deliberadamente **no** incluye las siguientes piezas, porque cada una
merece su propia sesión de diseño en vez de una decisión apurada aquí:

- **Auth** (NextAuth con credenciales + magic link): falta decidir proveedor
  de email, estrategia de sesión, y cómo se relaciona con el modelo de tenant.
- **Onboarding** (registro de empresa → crea su schema → redirige al
  dashboard): depende de que exista auth primero (plan §4, "Creación de tenant").
- **Migration runner real**
  ([`scripts/migrate-tenants.ts`](scripts/migrate-tenants.ts)): la estructura
  ya itera tenants activos, pero `runMigrationsForSchema` está documentada
  como TODO — decidir *cómo* versionar y aplicar migraciones contra schemas
  dinámicos de Postgres es la pieza que el propio plan marca como su mayor
  complejidad (ver el comentario extenso en ese archivo).
- **Deploy** (Railway/Render + CI): no tiene sentido configurarlo hasta que
  haya algo estable corriendo en él.
- **Módulos de negocio** (inventario, pedidos, finanzas, CRM): son las Fases
  1–3 del roadmap. `packages/shared` ya tiene los tipos y schemas Zod base
  extraídos del plan (`TipoMovimiento`, `EstadoPedido`, `TRANSICIONES_VALIDAS`,
  `Tenant`, `SubscriptionPlan`) para que esas fases construyan sobre terreno firme.
- **UI real** (`packages/ui`, vistas de `apps/web`): el placeholder actual
  espera los diseños que generes en Claude.
