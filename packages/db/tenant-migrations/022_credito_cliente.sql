-- Migración 022 — condiciones de crédito por cliente.
--
-- El vencimiento de las cuentas por cobrar estaba fijo en 30 días para todos
-- (`pedidos.ts`: `fechaVencimiento.setDate(getDate() + 30)`). En la vida real
-- de una PYME conviven clientes de contado, a 30 y a 60 días, y esa diferencia
-- es justamente lo que define cuándo se cobra.
--
--   plazo_dias   0 = contado (vence el mismo día). NULL = usar el default.
--   cupo_credito NULL = sin límite. Si se define, la app avisa cuando la deuda
--                del cliente lo supera — avisa, no bloquea: quien decide si le
--                sigue vendiendo a alguien es el dueño, no el software.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS plazo_dias   INTEGER,
                     ADD COLUMN IF NOT EXISTS cupo_credito NUMERIC(12,2);

ALTER TABLE clientes ADD CONSTRAINT plazo_dias_no_negativo CHECK (plazo_dias IS NULL OR plazo_dias >= 0);
ALTER TABLE clientes ADD CONSTRAINT cupo_credito_no_negativo CHECK (cupo_credito IS NULL OR cupo_credito >= 0);
