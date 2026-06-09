-- Migración 009 — Notas internas (tipo "iPhone Notes" del módulo de Comunicaciones).
-- Cada nota tiene título, contenido libre y un flag opcional de checkbox para
-- marcarla como "completada en general". El campo `orden` permite reordenación
-- manual vía drag-and-drop desde el cliente.

CREATE TABLE notas_internas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo         TEXT NOT NULL,
  contenido      TEXT,
  tiene_checkbox BOOLEAN NOT NULL DEFAULT FALSE,
  completada     BOOLEAN NOT NULL DEFAULT FALSE,
  orden          INTEGER NOT NULL DEFAULT 0,
  usuario_id     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX idx_notas_internas_orden ON notas_internas(orden ASC, created_at ASC);
