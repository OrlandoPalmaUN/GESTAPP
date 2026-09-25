-- Migración 030 — insumos (materia prima) y producciones.
--
-- El caso real: el queso no se compra por libras, se compra en bloque. Cuántas
-- libras salen se sabe al cortarlo, y siempre hay desperdicio en los bordes. Hoy
-- una OC de "1 bloque" mete 1 al inventario del producto que se vende por libra,
-- lo cual es simplemente falso: el stock queda mintiendo desde la compra.
--
-- ── Por qué NO un módulo de materia prima aparte ──────────────────────────
-- Un insumo se compra, se guarda y se cuenta igual que cualquier producto: ya
-- hay tablas para eso. Lo único que lo distingue es que NO SE VENDE. Así que es
-- un flag en `productos`, no un modelo paralelo — y de paso hereda gratis el
-- stock por movimientos, la papelera, la auditoría y el costo promedio.
ALTER TABLE productos ADD COLUMN IF NOT EXISTS es_insumo BOOLEAN NOT NULL DEFAULT false;

-- Un insumo no se le puede vender a un cliente: la API lo excluye del selector
-- de pedidos. El flag acá es la fuente de verdad de esa regla.
COMMENT ON COLUMN productos.es_insumo IS
  'true = materia prima. Se compra y se transforma, nunca se vende directo.';

-- ── Producciones ───────────────────────────────────────────────────────────
-- Una producción es UNA transacción: consume N de un insumo y produce M de uno o
-- varios productos vendibles. Es el eslabón que faltaba entre "compré un bloque"
-- y "tengo 18 libras".
--
-- El desperdicio NO se captura: se deduce. Si entró 1 bloque y salieron 18
-- libras, el rendimiento queda registrado; si el mes pasado fueron 20, se ve.
-- Pedirle al usuario que teclee "se perdieron 2 libras" sería pedirle un dato
-- que el sistema ya puede calcular, y que además nadie mide con precisión.
CREATE TABLE IF NOT EXISTS producciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero      TEXT NOT NULL UNIQUE,            -- PRD-2026-0001
  fecha       DATE NOT NULL DEFAULT CURRENT_DATE,
  notas       TEXT,
  usuario_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS produccion_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produccion_id  UUID NOT NULL REFERENCES producciones(id) ON DELETE CASCADE,
  -- 'consumo' = lo que entró al proceso; 'salida' = lo que salió de él.
  rol            TEXT NOT NULL CHECK (rol IN ('consumo', 'salida')),
  producto_id    UUID NOT NULL REFERENCES productos(id),
  variante_id    UUID REFERENCES variantes_producto(id),
  cantidad       NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  -- Costo unitario al momento de producir: para los consumos es el costo
  -- efectivo del insumo, para las salidas el costo calculado del proceso.
  -- Es un SNAPSHOT, por la misma razón que `pedido_items.precio_costo`
  -- (migración 007): recalcularlo después reescribiría la historia.
  costo_unitario NUMERIC(12,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_produccion_items_produccion ON produccion_items(produccion_id);
CREATE INDEX IF NOT EXISTS idx_produccion_items_producto   ON produccion_items(producto_id);
CREATE INDEX IF NOT EXISTS idx_producciones_fecha          ON producciones(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_producciones_papelera       ON producciones(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_productos_insumo            ON productos(es_insumo) WHERE es_insumo;

-- Auditoría — mismo trigger genérico de la 019.
DROP TRIGGER IF EXISTS trg_auditoria ON producciones;
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON producciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();

DROP TRIGGER IF EXISTS trg_auditoria ON produccion_items;
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON produccion_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();

-- Los movimientos de inventario de una producción usan dos tipos nuevos,
-- `consumo_produccion` (resta) y `entrada_produccion` (suma). No hay CHECK sobre
-- `movimientos_inventario.tipo` —es TEXT libre desde la 001— así que no hace
-- falta alterar nada: la lista válida vive en `TIPOS_MOVIMIENTO`
-- (packages/shared/src/types/inventario.ts) y la valida la API.
