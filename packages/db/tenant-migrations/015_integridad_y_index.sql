-- 015 — Mejoras de integridad y rendimiento cross-módulo.
--
-- 1. Garantiza FK explícita con ON DELETE SET NULL entre
--    pedidos_proveedor.factura_compra_id → facturas_compra.id.
--    Antes la FK existía en migraciones tempranas sin acción definida (default
--    NO ACTION), por lo que borrar una CxP bloqueaba la operación en vez de
--    desligar la OC. Ahora se desliga limpiamente.
--
-- 2. Índices auxiliares para los nuevos endpoints cross-módulo:
--      - /buscar (filtros por nombre/numero ILIKE)
--      - /dashboard/kpis (joins por cliente/proveedor)
--      - /inventario/stock-bajo (filtro por stock_minimo)
--      - /finanzas/facturas/vencidas (fecha_vencimiento parcial-orden)

-- ── 1. FK explícita en pedidos_proveedor.factura_compra_id ─────────────────
DO $$
DECLARE
  fk_name text;
BEGIN
  -- Buscar la FK existente apuntando a facturas_compra(id)
  SELECT tc.constraint_name
  INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
   AND tc.table_schema = ccu.table_schema
  WHERE tc.table_name = 'pedidos_proveedor'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name = 'facturas_compra'
    AND ccu.column_name = 'id'
    AND tc.table_schema = current_schema()
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE pedidos_proveedor DROP CONSTRAINT %I',
      fk_name
    );
  END IF;

  ALTER TABLE pedidos_proveedor
    ADD CONSTRAINT pedidos_proveedor_factura_compra_id_fkey
    FOREIGN KEY (factura_compra_id)
    REFERENCES facturas_compra(id)
    ON DELETE SET NULL;
END $$;

-- ── 2. Índices para búsqueda global ────────────────────────────────────────
-- ILIKE con índice GIN trigrama es mucho más rápido que sin él para
-- búsquedas substring sobre tablas grandes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_clientes_nombre_trgm
  ON clientes USING GIN (nombre gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_proveedores_nombre_trgm
  ON proveedores USING GIN (nombre gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_productos_nombre_trgm
  ON productos USING GIN (nombre gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_numero_trgm
  ON pedidos USING GIN (numero gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── 3. Índices para stock bajo y vencimientos ──────────────────────────────
-- Parcial por activo + stock_minimo > 0 — el grueso de filas no tiene umbral.
CREATE INDEX IF NOT EXISTS idx_productos_stock_minimo_activo
  ON productos (stock_minimo)
  WHERE deleted_at IS NULL AND activo = TRUE AND stock_minimo > 0;

CREATE INDEX IF NOT EXISTS idx_facturas_venta_vencimiento
  ON facturas_venta (fecha_vencimiento)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_facturas_compra_vencimiento
  ON facturas_compra (fecha_vencimiento)
  WHERE deleted_at IS NULL;

-- ── 4. Índice para movimientos_inventario por producto + tipo ──────────────
-- El cálculo de stock se hace agrupando por producto — beneficia mucho a
-- consultas grandes (stock-bajo, dashboard KPIs).
CREATE INDEX IF NOT EXISTS idx_movimientos_inv_producto_tipo
  ON movimientos_inventario (producto_id, tipo);
