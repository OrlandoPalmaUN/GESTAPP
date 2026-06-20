-- Configuración visual de la empresa: nombre a mostrar y slogan, editables
-- desde el módulo de Configuración (header de la app). Tabla singleton
-- (siempre id = 1) — no hay multi-fila porque es una sola empresa por schema.
CREATE TABLE IF NOT EXISTS config_empresa (
  id             INT         PRIMARY KEY DEFAULT 1,
  nombre_display TEXT,
  slogan         TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT config_empresa_singleton CHECK (id = 1)
);

INSERT INTO config_empresa (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
