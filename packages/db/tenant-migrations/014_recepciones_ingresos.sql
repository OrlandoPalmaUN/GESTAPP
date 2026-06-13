-- Migration 014: recepciones parciales de OC + ingresos manuales a cuentas bancarias

-- 1. Seguimiento de cantidades recibidas por ítem de OC.
--    Permite marcar una OC como "recibida parcialmente" especificando cuánto
--    llegó de cada ítem — el inventario y la CxP se generan solo por lo recibido.
ALTER TABLE pedidos_proveedor_items
  ADD COLUMN IF NOT EXISTS cantidad_recibida NUMERIC(12,3) NOT NULL DEFAULT 0;

-- 2. Ingresos manuales a cuentas bancarias.
--    Para registrar entradas de dinero que no son cobros de facturas:
--    capital propio, préstamos recibidos, devoluciones de proveedores, etc.
--    Cada ingreso suma al saldo de la cuenta de forma atómica y queda en la
--    papelera (soft delete) para poder deshacerse si fue un error.
CREATE TABLE IF NOT EXISTS ingresos_bancarios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descripcion         TEXT NOT NULL,
  categoria           TEXT NOT NULL DEFAULT 'otro'
    CHECK (categoria IN ('capital','prestamo','devolucion','venta_activo','otro')),
  monto               NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  medio_pago          TEXT,
  cuenta_bancaria_id  UUID NOT NULL REFERENCES cuentas_bancarias(id),
  notas               TEXT,
  usuario_id          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingresos_bancarios_cuenta ON ingresos_bancarios(cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_ingresos_bancarios_fecha  ON ingresos_bancarios(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ingresos_bancarios_papelera ON ingresos_bancarios(deleted_at) WHERE deleted_at IS NOT NULL;
