-- Historial de auditoría ("footsteps"): cada crear/editar/eliminar/restaurar
-- en las tablas de negocio queda registrado con quién lo hizo y qué cambió.
--
-- Diseño: UN trigger genérico (`public.fn_auditoria`, creado una sola vez en
-- el schema public — visible desde cualquier tenant porque public siempre
-- está al final del search_path) en vez de lógica manual repetida en cada
-- ruta. Así ninguna acción puede "olvidarse" de auditar: si la tabla tiene
-- el trigger, queda registrada sin que el código de la ruta haga nada extra.
--
-- `entidad_id` es TEXT (no UUID) porque config_empresa usa id INT (es
-- singleton, siempre id=1) — la función necesita ser genérica para
-- cualquier tipo de PK.
--
-- El usuario que hizo la acción se identifica vía el GUC de sesión
-- `app.current_user_id`, que tenant-resolver.ts deja seteado en la conexión
-- dedicada de cada request (ver asignarTenantAlRequest). Si no está seteado
-- (cron, scripts), la acción queda registrada con usuario_id NULL ("Sistema").

CREATE TABLE IF NOT EXISTS auditoria (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID,
  usuario_nombre TEXT,                 -- snapshot al momento de la acción — sobrevive si el usuario se elimina/cambia de nombre
  accion         TEXT NOT NULL,        -- crear | editar | eliminar | restaurar
  entidad_tipo   TEXT NOT NULL,        -- nombre de la tabla (TG_TABLE_NAME)
  entidad_id     TEXT NOT NULL,
  etiqueta       TEXT,                 -- nombre/número/título legible de la fila, para mostrar en el timeline sin otro join
  cambios        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { campo: { antes, despues } } — solo campos que de verdad cambiaron
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidad  ON auditoria(entidad_tipo, entidad_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario  ON auditoria(usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_creado   ON auditoria(created_at DESC);

-- ── Función de trigger genérica (vive en public, comparte código entre tenants) ──
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
  v_ref_json       JSONB;              -- la fila "vigente" para sacar la etiqueta (NEW salvo en DELETE)
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
      RETURN NEW; -- UPDATE que no cambió ningún campo real (ej: solo toca updated_at) — no generar ruido
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

-- ── Aplicar el trigger a las tablas de negocio (acciones de usuario) ──
-- Deliberadamente NO incluidas: `usuarios` (tabla local nunca poblada, ver
-- migración 002), y las tablas que solo escribe el scraper/cron de Instagram
-- (ig_posts, ig_comentarios, ig_post_snapshots, ig_cuenta_snapshots,
-- reportes_analisis) — auditarlas generaría miles de filas con usuario_id
-- NULL sin valor real, porque nadie las edita a mano.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'productos', 'categorias', 'clientes', 'proveedores',
    'pedidos', 'pedido_items', 'pedidos_proveedor', 'pedidos_proveedor_items',
    'facturas_venta', 'facturas_compra', 'abonos', 'gastos_operativos',
    'ingresos_bancarios', 'cuentas_bancarias', 'transferencias_bancarias',
    'eventos_calendario', 'notas_crm', 'notas_internas', 'config_empresa',
    'movimientos_inventario', 'ig_cuentas', 'ig_config'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria()',
      t
    );
  END LOOP;
END $$;
