-- Migración 010 — Pedidos a proveedores (órdenes de compra).
-- Permite registrar qué se le compra a cada proveedor, qué llegó y
-- generar automáticamente la CxP correspondiente al confirmar el pedido.

-- Estados del pedido a proveedor:
--   borrador → enviado (OC enviada al proveedor)
--             → recibido_parcial (llegó parte del pedido)
--             → recibido (todo llegó)
--             → cancelado (en cualquier momento antes de recibido)

CREATE TABLE pedidos_proveedor (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              TEXT NOT NULL UNIQUE,            -- e.g. OC-2026-0001
  proveedor_id        UUID REFERENCES proveedores(id),
  estado              TEXT NOT NULL DEFAULT 'borrador' -- borrador|enviado|recibido_parcial|recibido|cancelado
                      CHECK (estado IN ('borrador','enviado','recibido_parcial','recibido','cancelado')),
  fecha_esperada      DATE,
  notas               TEXT,
  total               NUMERIC(12,2) NOT NULL DEFAULT 0,
  factura_compra_id   UUID REFERENCES facturas_compra(id), -- CxP generada al recibir
  usuario_id          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_pedidos_proveedor_proveedor  ON pedidos_proveedor(proveedor_id);
CREATE INDEX idx_pedidos_proveedor_estado     ON pedidos_proveedor(estado);
CREATE INDEX idx_pedidos_proveedor_created    ON pedidos_proveedor(created_at DESC);

-- Ítems del pedido a proveedor
CREATE TABLE pedidos_proveedor_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_proveedor_id UUID NOT NULL REFERENCES pedidos_proveedor(id) ON DELETE CASCADE,
  producto_id         UUID REFERENCES productos(id),  -- NULL si el ítem es libre
  concepto            TEXT,                            -- descripción para ítems libres
  cantidad            NUMERIC(12,3) NOT NULL,
  precio_unitario     NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal            NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);

CREATE INDEX idx_pedidos_proveedor_items_pedido ON pedidos_proveedor_items(pedido_proveedor_id);

-- También necesitamos poder enlazar facturas_compra con el pedido que las originó
-- (para que la CxP pueda mostrar "generada desde OC-2026-0001").
-- Agregamos la columna si no existe ya (idempotente).
ALTER TABLE facturas_compra ADD COLUMN IF NOT EXISTS pedido_proveedor_id UUID REFERENCES pedidos_proveedor(id);
