-- Migración 011 — Notas con modo checklist (lista de tareas tipo iPhone Notes).
-- Agrega tipo_contenido a notas_internas:
--   'texto'  → contenido es HTML rico (comportamiento anterior, default)
--   'lista'  → contenido es JSON array de ChecklistItem [{id,texto,checked,orden}]

ALTER TABLE notas_internas
  ADD COLUMN IF NOT EXISTS tipo_contenido TEXT NOT NULL DEFAULT 'texto'
  CHECK (tipo_contenido IN ('texto', 'lista'));
