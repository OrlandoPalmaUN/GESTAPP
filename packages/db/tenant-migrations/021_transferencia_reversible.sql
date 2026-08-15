-- Migración 021 — permite revertir una transferencia bancaria.
--
-- `transferencias_bancarias` era la única tabla de movimiento de dinero sin
-- `deleted_at`: la ruta solo tenía GET y POST, así que una transferencia hecha
-- por error movía saldo real en dos cuentas y no había forma de deshacerla
-- desde la aplicación (había que tocar la base a mano).
--
-- Se agrega `deleted_at` para que el DELETE sea suave —la fila queda como
-- evidencia de que la transferencia existió y se revirtió— mientras la ruta
-- devuelve los saldos a su estado anterior dentro de la misma transacción.
--
-- Nota: a propósito NO entra a la Papelera. "Restaurar" una transferencia
-- equivale a volver a hacerla (y podría fallar por saldo insuficiente); para
-- eso ya existe crear una transferencia nueva.

ALTER TABLE transferencias_bancarias ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
