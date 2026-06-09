-- Migración 003 — CRM: catálogo de proveedores y bitácora de interacciones
-- (notas) sobre clientes/proveedores. Antes vivían como datos hardcodeados
-- en el frontend (`INITIAL_SUPPLIERS`, `crmTimeline`); ahora son reales.

-- Proveedores — espejo de `clientes` con un campo adicional `contacto`
-- (nombre de la persona de contacto en la empresa proveedora).
CREATE TABLE proveedores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  nit         TEXT UNIQUE,
  email       TEXT,
  telefono    TEXT,
  direccion   TEXT,
  contacto    TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bitácora de interacciones comerciales (CRM) — notas libres asociadas a un
-- cliente o proveedor. `entidad_id` NO lleva FK porque apunta a una de dos
-- tablas distintas según `entidad_tipo` (FK polimórfica clásica: se valida en
-- la capa de aplicación, igual que `referencia_id` en `movimientos_inventario`).
CREATE TABLE notas_crm (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad_tipo  TEXT NOT NULL CHECK (entidad_tipo IN ('cliente', 'proveedor')),
  entidad_id    UUID NOT NULL,
  nota          TEXT NOT NULL,
  usuario_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notas_crm_entidad_idx ON notas_crm (entidad_tipo, entidad_id, created_at DESC);
