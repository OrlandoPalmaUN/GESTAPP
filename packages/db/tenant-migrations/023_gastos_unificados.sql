-- Migración 023 — Gastos como sección única (fusión de Compras/OC dentro de Gastos).
--
-- Para el dueño de una PYME "orden de compra" y "gasto operacional" son la
-- misma cosa: plata que sale. Tenerlos en dos módulos distintos hacía que el
-- de Compras quedara sin usar y que las compras de mercancía no entraran al
-- inventario. La app pedía dos modelos mentales donde el negocio tiene uno.
--
-- La fusión es de INTERFAZ, no de datos: `gastos_operativos` y
-- `pedidos_proveedor` siguen existiendo tal cual, con sus filas intactas.
-- Esta migración solo agrega lo que faltaba para que una sola pantalla pueda
-- manejar ambas.
--
-- OJO con el numerador: falta el 018 (017 → 019). NO se debe rellenar ese
-- hueco: el runner ordena por nombre de archivo y registra los aplicados en
-- `public.migration_log`, así que un 018 nuevo correría DESPUÉS del 022 en los
-- tenants que ya existen pero ANTES del 019 en los nuevos — dos esquemas
-- distintos con el mismo historial.

-- ── 1. Más tipos de gasto ───────────────────────────────────────────────────
-- El CHECK original es anónimo, así que Postgres lo autonombró
-- `gastos_operativos_categoria_check`. En vez de confiar en ese nombre (que
-- puede diferir entre schemas de tenant), se busca en pg_constraint cualquier
-- CHECK sobre la columna y se reemplaza.
--
-- SOLO SE AGREGA. Nunca quitar 'arriendo','servicios','nomina','comisiones',
-- 'marketing','otros': hay filas vivas con esos valores.
--
-- Y nunca agregar acá una categoría de "compra de inventario / mercancía": esa
-- plata se registra en `pedidos_proveedor`, no acá. Si entrara como gasto, los
-- reportes la restarían de la utilidad neta Y ADEMÁS restarían el costo de la
-- misma mercancía al venderla (vía `pedido_items.precio_costo`) — el mismo
-- egreso contado dos veces. Ver el comentario largo en routes/tenant/reportes.ts.
DO $$
DECLARE nombre_constraint TEXT;
BEGIN
  FOR nombre_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'gastos_operativos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%categoria%'
  LOOP
    EXECUTE format('ALTER TABLE gastos_operativos DROP CONSTRAINT %I', nombre_constraint);
  END LOOP;
END $$;

ALTER TABLE gastos_operativos ADD CONSTRAINT gastos_operativos_categoria_check
  CHECK (categoria IN (
    'arriendo', 'servicios', 'nomina', 'comisiones', 'marketing', 'otros',
    'transporte', 'impuestos', 'mantenimiento', 'honorarios', 'financieros'
  ));

-- ── 2. Gasto a crédito ──────────────────────────────────────────────────────
-- Hasta ahora todo gasto salía de una cuenta bancaria en el momento. Con el
-- switch "pagado / queda debiendo", un gasto puede generar una CxP en vez de
-- mover el banco; `factura_compra_id` es el vínculo con esa cuenta por pagar.
ALTER TABLE gastos_operativos
  ADD COLUMN IF NOT EXISTS proveedor_id       UUID REFERENCES proveedores(id),
  ADD COLUMN IF NOT EXISTS factura_compra_id  UUID REFERENCES facturas_compra(id);

-- ── 3. Fecha real de la compra ──────────────────────────────────────────────
-- `pedidos_proveedor` no tenía columna de fecha de negocio: los reportes la
-- sacaban de `created_at` (timestamptz) mientras los gastos usan `fecha`
-- (date). En UTC-5 eso corre el límite ~5 horas, así que dos registros
-- cargados la misma noche podían caer en meses distintos según de qué tabla
-- vinieran. Además impedía retro-fechar una compra, algo que el resto de los
-- gastos sí permite — inaceptable si ahora comparten formulario y listado.
ALTER TABLE pedidos_proveedor ADD COLUMN IF NOT EXISTS fecha DATE;
UPDATE pedidos_proveedor SET fecha = created_at::date WHERE fecha IS NULL;
ALTER TABLE pedidos_proveedor ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;
ALTER TABLE pedidos_proveedor ALTER COLUMN fecha SET NOT NULL;

-- ── 4. Índices ──────────────────────────────────────────────────────────────
-- El listado unificado ordena por fecha y filtra por categoría; hasta ahora
-- `gastos_operativos` no tenía un solo índice.
CREATE INDEX IF NOT EXISTS idx_gastos_operativos_fecha     ON gastos_operativos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_gastos_operativos_categoria ON gastos_operativos(categoria);
CREATE INDEX IF NOT EXISTS idx_pedidos_proveedor_fecha     ON pedidos_proveedor(fecha DESC);
