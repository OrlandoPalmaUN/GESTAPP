-- Migración 028 — préstamos y retiros del dueño/socio.
--
-- El caso real: la dueña saca plata de la caja del negocio para gastos
-- personales, pero no como salida definitiva — es plata que piensa devolver.
-- Hoy la única forma de registrarlo era un gasto operativo, y eso miente en dos
-- direcciones a la vez: hunde la utilidad del mes con algo que no es un gasto
-- del negocio, y borra el hecho de que ese dinero se debe.
--
-- El registro correcto no es un gasto: es un ACTIVO QUE CAMBIA DE FORMA. La
-- plata sale del banco y a cambio el negocio queda con un derecho de cobro
-- contra el socio. El patrimonio no se movió, solo cambió de casillero. Por eso
-- un retiro baja el saldo bancario pero NO toca la utilidad.
--
-- Por qué tabla propia y no una categoría de gasto marcada `afecta_utilidad =
-- false` (migración 027): esa alternativa resuelve la utilidad pero no lleva
-- SALDO. La pregunta que la dueña realmente tiene es "de lo que saqué, cuánto
-- llevo devuelto", y eso necesita emparejar cada devolución con su retiro.
--
-- `retiro_id` es ese emparejamiento — mismo patrón que `abonos` contra
-- `facturas_venta`: un retiro puede recibir varias devoluciones parciales, y el
-- saldo vivo es la resta. Sin eso solo se puede calcular el neto global, que no
-- distingue entre "devolvió casi todo" y "sacó y devolvió muchas veces".
--
-- Es global, no de un tenant: cualquier PYME familiar mezcla la plata del
-- negocio con la personal, y el problema de fondo es el mismo en todas.

CREATE TABLE IF NOT EXISTS movimientos_socio (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                TEXT NOT NULL CHECK (tipo IN ('retiro', 'devolucion')),
  -- Texto libre y no FK a `usuarios`: quien saca la plata es el DUEÑO del
  -- negocio, que muchas veces no tiene login en la app (la usa un empleado), y
  -- puede haber socios que nunca van a ser usuarios del sistema.
  socio               TEXT NOT NULL,
  monto               NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
  -- De qué cuenta salió / a cuál volvió. Obligatoria: un retiro que no sale de
  -- ninguna cuenta no movió plata, y entonces no hay nada que registrar.
  cuenta_bancaria_id  UUID NOT NULL REFERENCES cuentas_bancarias(id),
  -- Solo en devoluciones: a qué retiro abona. NULL = devolución sin imputar a
  -- un retiro puntual (baja el saldo global del socio).
  retiro_id           UUID REFERENCES movimientos_socio(id),
  notas               TEXT,
  usuario_id          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

-- Un retiro no puede apuntar a otro retiro: solo las devoluciones imputan.
ALTER TABLE movimientos_socio DROP CONSTRAINT IF EXISTS retiro_id_solo_en_devoluciones;
ALTER TABLE movimientos_socio ADD CONSTRAINT retiro_id_solo_en_devoluciones
  CHECK (retiro_id IS NULL OR tipo = 'devolucion');

CREATE INDEX IF NOT EXISTS idx_movimientos_socio_fecha    ON movimientos_socio(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_socio_socio    ON movimientos_socio(lower(socio));
CREATE INDEX IF NOT EXISTS idx_movimientos_socio_retiro   ON movimientos_socio(retiro_id) WHERE retiro_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_socio_papelera ON movimientos_socio(deleted_at) WHERE deleted_at IS NOT NULL;

-- Auditoría — mismo trigger genérico de la 019.
DROP TRIGGER IF EXISTS trg_auditoria ON movimientos_socio;
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON movimientos_socio
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();
