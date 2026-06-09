-- Migración 005 — Comunicaciones: calendario/planner (notas, recordatorios y
-- posts planeados para redes sociales). Es la mitad "real" del módulo de
-- Comunicaciones — el dashboard de métricas sociales sigue siendo mock hasta
-- que el negocio conecte una cuenta real de Meta (requiere registrar una app
-- en Meta for Developers y generar tokens; eso queda fuera de este alcance).

-- Un solo tipo de evento cubre los tres casos (nota / recordatorio / post
-- planeado) — se diferencian por `tipo` y por qué campos llenan. `canal` solo
-- aplica a los posts planeados (a qué red social va dirigido); `estado` es de
-- uso libre por tipo ('pendiente'/'hecho' para notas y recordatorios,
-- 'idea'/'listo'/'publicado' para posts) y se valida en la capa de aplicación.
CREATE TABLE eventos_calendario (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        TEXT NOT NULL CHECK (tipo IN ('nota', 'recordatorio', 'post')),
  titulo      TEXT NOT NULL,
  descripcion TEXT,
  fecha       DATE NOT NULL,
  canal       TEXT CHECK (canal IS NULL OR canal IN ('instagram', 'facebook', 'tiktok')),
  estado      TEXT NOT NULL DEFAULT 'pendiente',
  usuario_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eventos_calendario_fecha ON eventos_calendario(fecha);
