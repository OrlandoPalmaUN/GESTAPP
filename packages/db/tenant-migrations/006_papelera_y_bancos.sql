-- Migración 006 — borrado suave ("papelera"/deshacer) genérico para los
-- módulos operativos + cuentas bancarias reales (antes hardcodeadas en el
-- frontend como `INITIAL_BANK_ACCOUNTS`).
--
-- Patrón elegido: en vez de mover filas a una tabla genérica (que rompería
-- las FKs y complicaría restaurar relaciones — p. ej. un pedido con sus
-- `pedido_items`), agregamos `deleted_at TIMESTAMPTZ` a cada tabla operativa.
-- Borrar = `UPDATE ... SET deleted_at = NOW()`; restaurar = poner NULL de
-- nuevo. Las consultas normales filtran `WHERE deleted_at IS NULL`, y un
-- endpoint de "papelera" agrega lo borrado recientemente de todas las tablas
-- para poder deshacer — igual que "el stock nunca se escribe directo": acá
-- "nada se borra directo", queda un rastro reversible.

ALTER TABLE productos          ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE categorias         ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE clientes           ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE proveedores        ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE pedidos            ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE facturas_venta     ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE facturas_compra    ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE abonos             ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE eventos_calendario ADD COLUMN deleted_at TIMESTAMPTZ;

-- Índices parciales: solo indexan las filas borradas (las que la papelera
-- necesita listar rápido); las consultas normales ya tenían sus índices.
CREATE INDEX idx_productos_papelera          ON productos(deleted_at)          WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_categorias_papelera         ON categorias(deleted_at)         WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_clientes_papelera           ON clientes(deleted_at)           WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_proveedores_papelera        ON proveedores(deleted_at)        WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_pedidos_papelera            ON pedidos(deleted_at)            WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_facturas_venta_papelera     ON facturas_venta(deleted_at)     WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_facturas_compra_papelera    ON facturas_compra(deleted_at)    WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_abonos_papelera             ON abonos(deleted_at)             WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_eventos_calendario_papelera ON eventos_calendario(deleted_at) WHERE deleted_at IS NOT NULL;

-- Cuentas bancarias — vivían como `INITIAL_BANK_ACCOUNTS` en el frontend.
CREATE TABLE cuentas_bancarias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banco       TEXT NOT NULL,
  numero      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'ahorros' CHECK (tipo IN ('ahorros', 'corriente')),
  saldo       NUMERIC(14,2) NOT NULL DEFAULT 0,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cuentas_bancarias_papelera ON cuentas_bancarias(deleted_at) WHERE deleted_at IS NOT NULL;
