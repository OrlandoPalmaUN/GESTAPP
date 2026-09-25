-- Migración 031 — campañas de preventa ("los domingos de pastel").
--
-- El caso real: una vez al mes se vende pastel colombiano. Se promociona una
-- semana, la gente encarga por WhatsApp, y el domingo se entrega todo junto. El
-- pastel NO se produce: se le compra terminado a la señora que lo cocina, así
-- que su costo entra por el promedio ponderado de compras como cualquier
-- reventa (migración 029) — acá no hay nada de producción.
--
-- Lo que faltaba no era un flujo nuevo: los encargos ya son pedidos normales y
-- los sabores ya se modelan con las variantes que existen desde la 020 (un
-- producto "Pastel" con atributo "Sabor"). Lo que faltaba era poder AGRUPARLOS
-- para contestar una sola pregunta: "¿cuántos de cada sabor le pido a la
-- cocinera?". Hoy eso se suma a mano, pedido por pedido.
--
-- Por eso una campaña es un AGRUPADOR, no un tipo de venta: una tabla chica y
-- una FK opcional en `pedidos`. Un pedido sin campaña se comporta exactamente
-- como antes, que es la propiedad importante — esto no puede cambiar en nada el
-- flujo de pedidos del día a día.

CREATE TABLE IF NOT EXISTS campanas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,                   -- "Pasteles - domingo 12 de octubre"
  fecha_entrega   DATE NOT NULL,
  -- abierta   → se aceptan encargos
  -- cerrada   → ya se pidió a la proveedora, no entran más
  -- entregada → se repartió
  -- cancelada → no se hizo
  estado          TEXT NOT NULL DEFAULT 'abierta'
                  CHECK (estado IN ('abierta', 'cerrada', 'entregada', 'cancelada')),
  notas           TEXT,
  usuario_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Nullable a propósito: es lo que mantiene el pedido normal siendo normal.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS campana_id UUID REFERENCES campanas(id);

-- Índice parcial: la enorme mayoría de los pedidos no pertenece a ninguna
-- campaña, y no tiene sentido indexar millones de NULL.
CREATE INDEX IF NOT EXISTS idx_pedidos_campana ON pedidos(campana_id) WHERE campana_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campanas_entrega  ON campanas(fecha_entrega DESC);
CREATE INDEX IF NOT EXISTS idx_campanas_estado   ON campanas(estado);
CREATE INDEX IF NOT EXISTS idx_campanas_papelera ON campanas(deleted_at) WHERE deleted_at IS NOT NULL;

-- Auditoría — mismo trigger genérico de la 019.
DROP TRIGGER IF EXISTS trg_auditoria ON campanas;
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON campanas
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();
