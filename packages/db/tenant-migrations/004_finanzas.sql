-- Migración 004 — Finanzas: cuentas por pagar (CxP). `facturas_venta` (CxC) y
-- `abonos` ya existían desde 001_init (con `abonos.tipo_documento` previendo
-- 'factura_venta' | 'factura_compra'), pero la tabla de facturas de COMPRA
-- nunca se creó — sin ella, el lado CxP de Finanzas no tenía dónde vivir.

-- Facturas de compra (CxP) — espejo de `facturas_venta`, referencia proveedores.
CREATE TABLE facturas_compra (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            TEXT NOT NULL UNIQUE,
  proveedor_id      UUID REFERENCES proveedores(id),
  fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,
  total             NUMERIC(12,2) NOT NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_facturas_compra_proveedor ON facturas_compra(proveedor_id);
-- (idx_abonos_documento ya existe desde 001_init — no se repite aquí)

-- Mismo bug que 002: `abonos.usuario_id` apunta a la tabla `usuarios` LOCAL del
-- tenant (que nunca se llena — los usuarios reales viven en `public.usuarios`).
-- Sin quitar esta FK, el primer abono registrado por un usuario real fallaría
-- con 23503, igual que pasaba con `movimientos_inventario`/`pedidos`.
ALTER TABLE abonos DROP CONSTRAINT IF EXISTS abonos_usuario_id_fkey;

