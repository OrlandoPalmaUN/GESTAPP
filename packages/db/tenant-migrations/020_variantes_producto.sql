-- Variantes de producto (talla, color, o cualquier otro atributo) — opt-in
-- por producto: si `tiene_variantes = false` (default), todo sigue
-- funcionando exactamente como antes — el stock vive en `productos` vía
-- `movimientos_inventario.producto_id`, sin tocar nada nuevo. Solo cuando un
-- negocio activa variantes para un producto puntual entra en juego
-- `variantes_producto`, y el stock se mueve al nivel de variante.
--
-- Atributos genéricos (NO hardcodeado a "talla"/"color"): `producto_atributos`
-- define los ejes que varían para ESE producto (una tienda de ropa puede usar
-- Talla+Color, una de electrónica Capacidad+Color, etc.), y
-- `variantes_producto.valores` es JSONB con esos pares clave-valor —
-- {"Talla": "L", "Color": "Negro"} — así no hay que migrar el esquema cada
-- vez que un negocio distinto necesita variar por otra cosa.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS tiene_variantes BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS producto_atributos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,         -- "Talla", "Color", "Material"...
  orden         INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_producto_atributos_producto ON producto_atributos(producto_id);

CREATE TABLE IF NOT EXISTS variantes_producto (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id   UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sku           TEXT,
  valores       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"Talla":"L","Color":"Negro"}
  precio_venta  NUMERIC(12,2),         -- override; NULL = hereda productos.precio_venta
  activo        BOOLEAN NOT NULL DEFAULT true,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variantes_producto_producto ON variantes_producto(producto_id);

-- Misma combinación de atributos no puede repetirse dos veces para el mismo
-- producto (excluye soft-deleted: una variante borrada no bloquea recrearla).
CREATE UNIQUE INDEX IF NOT EXISTS idx_variantes_producto_unicas
  ON variantes_producto(producto_id, valores) WHERE deleted_at IS NULL;

-- SKU único en todo el tenant cuando se define (igual que productos.sku).
CREATE UNIQUE INDEX IF NOT EXISTS idx_variantes_producto_sku
  ON variantes_producto(sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;

-- El stock y los pedidos pueden apuntar a una variante puntual en vez de (o
-- además de) al producto-modelo. NULL en ambas tablas = comportamiento actual
-- sin cambios (producto sin variantes).
ALTER TABLE movimientos_inventario ADD COLUMN IF NOT EXISTS variante_id UUID REFERENCES variantes_producto(id);
ALTER TABLE pedido_items           ADD COLUMN IF NOT EXISTS variante_id UUID REFERENCES variantes_producto(id);

CREATE INDEX IF NOT EXISTS idx_movimientos_variante ON movimientos_inventario(variante_id) WHERE variante_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedido_items_variante ON pedido_items(variante_id) WHERE variante_id IS NOT NULL;

-- `variantes_producto` no tiene nombre/numero/titulo/email/handle (los
-- campos que ya cubre el COALESCE de fn_auditoria), así que sin esto sus
-- entradas en el timeline de Actividad mostrarían el UUID crudo en vez del
-- SKU — actualizamos la función (CREATE OR REPLACE, misma función que usan
-- TODOS los tenants) para agregar 'sku' a la cadena de fallback.
CREATE OR REPLACE FUNCTION public.fn_auditoria()
RETURNS TRIGGER AS $$
DECLARE
  v_usuario_id     UUID;
  v_usuario_nombre TEXT;
  v_accion         TEXT;
  v_entidad_id     TEXT;
  v_etiqueta       TEXT;
  v_old_json       JSONB;
  v_new_json       JSONB;
  v_ref_json       JSONB;
  v_cambios        JSONB := '{}'::jsonb;
  v_key            TEXT;
  v_excluir        TEXT[] := ARRAY['updated_at', 'created_at', 'id'];
BEGIN
  v_usuario_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  IF v_usuario_id IS NOT NULL THEN
    SELECT nombre INTO v_usuario_nombre FROM public.usuarios WHERE id = v_usuario_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new_json   := to_jsonb(NEW);
    v_entidad_id := v_new_json->>'id';
    v_accion     := 'crear';
    v_ref_json   := v_new_json;

    FOR v_key IN SELECT k FROM jsonb_object_keys(v_new_json) AS k WHERE k <> ALL (v_excluir)
    LOOP
      IF (v_new_json->>v_key) IS NOT NULL THEN
        v_cambios := v_cambios || jsonb_build_object(v_key, jsonb_build_object('antes', NULL, 'despues', v_new_json->v_key));
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' THEN
    v_old_json   := to_jsonb(OLD);
    v_new_json   := to_jsonb(NEW);
    v_entidad_id := v_new_json->>'id';
    v_ref_json   := v_new_json;

    IF (v_old_json->>'deleted_at') IS NULL AND (v_new_json->>'deleted_at') IS NOT NULL THEN
      v_accion := 'eliminar';
    ELSIF (v_old_json->>'deleted_at') IS NOT NULL AND (v_new_json->>'deleted_at') IS NULL THEN
      v_accion := 'restaurar';
    ELSE
      v_accion := 'editar';
    END IF;

    FOR v_key IN SELECT k FROM jsonb_object_keys(v_new_json) AS k WHERE k <> ALL (v_excluir)
    LOOP
      IF (v_old_json->v_key) IS DISTINCT FROM (v_new_json->v_key) THEN
        v_cambios := v_cambios || jsonb_build_object(v_key, jsonb_build_object('antes', v_old_json->v_key, 'despues', v_new_json->v_key));
      END IF;
    END LOOP;

    IF v_cambios = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    v_old_json   := to_jsonb(OLD);
    v_entidad_id := v_old_json->>'id';
    v_accion     := 'eliminar';
    v_ref_json   := v_old_json;

    FOR v_key IN SELECT k FROM jsonb_object_keys(v_old_json) AS k WHERE k <> ALL (v_excluir)
    LOOP
      IF (v_old_json->>v_key) IS NOT NULL THEN
        v_cambios := v_cambios || jsonb_build_object(v_key, jsonb_build_object('antes', v_old_json->v_key, 'despues', NULL));
      END IF;
    END LOOP;
  END IF;

  v_etiqueta := COALESCE(
    v_ref_json->>'numero',
    v_ref_json->>'nombre',
    v_ref_json->>'titulo',
    v_ref_json->>'email',
    v_ref_json->>'handle',
    v_ref_json->>'sku',
    v_entidad_id
  );

  INSERT INTO auditoria (usuario_id, usuario_nombre, accion, entidad_tipo, entidad_id, etiqueta, cambios)
  VALUES (v_usuario_id, v_usuario_nombre, v_accion, TG_TABLE_NAME, v_entidad_id, v_etiqueta, v_cambios);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auditoría ("footsteps", migración 019) también para las tablas nuevas.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['producto_atributos', 'variantes_producto']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria()',
      t
    );
  END LOOP;
END $$;
