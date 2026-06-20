-- Guarda los análisis IA generados por período para no tener que regenerarlos cada vez.
-- periodo_key: "2026-06" (mes) | "2026-W24" (semana) | "2026-06-01_2026-06-14" (rango libre)
CREATE TABLE IF NOT EXISTS reportes_analisis (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_key     TEXT        NOT NULL,
  periodo_label   TEXT        NOT NULL,
  desde           DATE        NOT NULL,
  hasta           DATE        NOT NULL,
  analisis        TEXT        NOT NULL,
  posts_analizados INT        NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reportes_analisis_key ON reportes_analisis(periodo_key);
