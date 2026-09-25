-- Migración 027 — categorías de gasto/ingreso definidas por cada tenant.
--
-- Hasta acá las categorías eran un enum fijo de 11 valores (`CATEGORIAS_GASTO`
-- en packages/shared) replicado en un CHECK de la tabla y en una copia local
-- del front. Eso funciona para un catálogo universal, y los rubros de gasto no
-- lo son: una tienda de barrio tiene "transporte de mercancía" y una
-- consultora "software"; obligar a las dos a elegir entre los mismos 11 rubros
-- convierte a "otros" en el cajón donde termina la mitad del gasto, y ahí ya no
-- hay reporte que sirva.
--
-- Por qué una tabla y no ampliar el enum: agregar valores al enum exige una
-- migración por cada negocio nuevo. Además, `categorias` (las de producto) ya
-- es una tabla por tenant — esto solo aplica el mismo patrón que ya estaba.
--
-- ── Sobre `flujo` ──────────────────────────────────────────────────────────
-- La tabla guarda las categorías de egreso Y las de ingreso, aunque se llame
-- `categorias_gasto`: son el mismo concepto ("en qué rubro clasifico este
-- movimiento de plata") y tenerlas en dos tablas idénticas solo duplicaría el
-- CRUD, el admin de la UI y el trigger de auditoría. `flujo` las separa.
--
-- ── Sobre `afecta_utilidad` ────────────────────────────────────────────────
-- Al quitar el CHECK, nada impide que un tenant cree "compra de mercancía" y
-- registre ahí sus compras. Eso duplicaría el egreso: se restaría como gasto Y
-- otra vez como costo al vender la misma mercancía (el problema que documenta
-- largo la migración 023 y `routes/tenant/reportes.ts`). Con el enum fijo eso
-- lo prevenía la base; ahora no puede, así que la defensa pasa a ser este flag
-- más un aviso en la UI.
--
-- OJO con qué significa: `afecta_utilidad = false` saca el movimiento de la
-- UTILIDAD, no del FLUJO DE CAJA. Un aporte de capital es plata que entró de
-- verdad y tiene que aparecer en la caja; lo que no es, es una venta. Son dos
-- preguntas distintas y el flag solo responde la segunda.

CREATE TABLE IF NOT EXISTS categorias_gasto (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           TEXT NOT NULL,
  flujo            TEXT NOT NULL CHECK (flujo IN ('egreso', 'ingreso')),
  -- Identificador de las categorías sembradas por esta migración. Sirve para
  -- dos cosas: el backfill de abajo (mapear el TEXT viejo a la fila nueva sin
  -- adivinar por nombre) y distinguir lo que vino de fábrica de lo que creó el
  -- negocio. NULL = la creó el tenant.
  slug             TEXT,
  afecta_utilidad  BOOLEAN NOT NULL DEFAULT true,
  orden            INT NOT NULL DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dos categorías activas con el mismo nombre y flujo serían indistinguibles en
-- el selector. Excluye las inactivas a propósito: desactivar "Arriendo" y
-- crear una nueva con ese nombre es legítimo.
CREATE UNIQUE INDEX IF NOT EXISTS categorias_gasto_nombre_unica
  ON categorias_gasto (lower(nombre), flujo) WHERE activo;

CREATE UNIQUE INDEX IF NOT EXISTS categorias_gasto_slug_unico
  ON categorias_gasto (slug) WHERE slug IS NOT NULL;

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Exactamente los valores que hoy acepta el CHECK, con los mismos labels que
-- ya muestra el front (LABEL_CATEGORIA_GASTO en page.tsx). Así ningún tenant
-- existente ve un cambio: sus gastos siguen clasificados igual.
--
-- `capital` y `prestamo` entran con afecta_utilidad = false: un aporte del
-- socio o un préstamo recibido no son ingresos del negocio, son financiación.
-- Contarlos como ingreso infla la utilidad con plata que no se ganó vendiendo.
INSERT INTO categorias_gasto (nombre, flujo, slug, afecta_utilidad, orden)
VALUES
  ('Arriendo',      'egreso',  'arriendo',      true,  10),
  ('Servicios',     'egreso',  'servicios',     true,  20),
  ('Nómina',        'egreso',  'nomina',        true,  30),
  ('Comisiones',    'egreso',  'comisiones',    true,  40),
  ('Marketing',     'egreso',  'marketing',     true,  50),
  ('Transporte',    'egreso',  'transporte',    true,  60),
  ('Impuestos',     'egreso',  'impuestos',     true,  70),
  ('Mantenimiento', 'egreso',  'mantenimiento', true,  80),
  ('Honorarios',    'egreso',  'honorarios',    true,  90),
  ('Financieros',   'egreso',  'financieros',   true, 100),
  ('Otros',         'egreso',  'otros',         true, 110),
  ('Capital',       'ingreso', 'capital',       false, 10),
  ('Préstamo',      'ingreso', 'prestamo',      false, 20),
  ('Devolución',    'ingreso', 'devolucion',    true,  30),
  ('Venta de activo','ingreso','venta_activo',  true,  40),
  ('Otro',          'ingreso', 'otro',          true,  50)
ON CONFLICT (slug) WHERE slug IS NOT NULL DO NOTHING;

-- ── Vínculo desde los movimientos ──────────────────────────────────────────
ALTER TABLE gastos_operativos  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias_gasto(id);
ALTER TABLE ingresos_bancarios ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias_gasto(id);

-- Backfill por slug — exacto, no por nombre. Las filas existentes quedan
-- apuntando a la categoría sembrada equivalente.
UPDATE gastos_operativos g
   SET categoria_id = c.id
  FROM categorias_gasto c
 WHERE c.flujo = 'egreso' AND c.slug = g.categoria AND g.categoria_id IS NULL;

UPDATE ingresos_bancarios i
   SET categoria_id = c.id
  FROM categorias_gasto c
 WHERE c.flujo = 'ingreso' AND c.slug = i.categoria AND i.categoria_id IS NULL;

-- Red de seguridad: cualquier fila cuyo TEXT no matchee ningún slug (no debería
-- haber, el CHECK lo impedía) cae en "Otros"/"Otro" en vez de quedar sin
-- categoría y desaparecer de los reportes agrupados.
UPDATE gastos_operativos g
   SET categoria_id = (SELECT id FROM categorias_gasto WHERE slug = 'otros')
 WHERE g.categoria_id IS NULL;

UPDATE ingresos_bancarios i
   SET categoria_id = (SELECT id FROM categorias_gasto WHERE slug = 'otro')
 WHERE i.categoria_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_gastos_operativos_categoria_id  ON gastos_operativos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_ingresos_bancarios_categoria_id ON ingresos_bancarios(categoria_id);

-- ── Fuera el CHECK ─────────────────────────────────────────────────────────
-- Es lo que impide que un tenant defina sus propios rubros. Mismo patrón que
-- la 023: el constraint es anónimo y Postgres lo autonombra, así que se busca
-- en pg_constraint en vez de confiar en un nombre que puede diferir por schema.
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

  FOR nombre_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'ingresos_bancarios'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%categoria%'
  LOOP
    EXECUTE format('ALTER TABLE ingresos_bancarios DROP CONSTRAINT %I', nombre_constraint);
  END LOOP;
END $$;

-- La columna `categoria` TEXT se QUEDA, con datos y todo: hay filas vivas y
-- código leyéndola. Se retira en una migración posterior, cuando nada la use.
-- Mientras tanto la API escribe las dos (el slug en `categoria` cuando existe,
-- y siempre el `categoria_id`), así que un rollback del deploy no pierde nada.

-- Auditoría para la tabla nueva — mismo trigger genérico de la 019.
DROP TRIGGER IF EXISTS trg_auditoria ON categorias_gasto;
CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON categorias_gasto
  FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();
