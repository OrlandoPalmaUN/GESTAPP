-- 013 — Redes sociales: cuenta IG, snapshots de perfil, posts y comentarios.
-- Datos vienen de Apify (perfil público).
-- Campos "Meta Graph only" son nullable — se rellenan si el tenant conecta OAuth Business en el futuro.

CREATE TABLE ig_cuentas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle          TEXT NOT NULL,
  ig_user_id      TEXT,
  display_name    TEXT,
  bio             TEXT,
  avatar_url      TEXT,
  es_verificada   BOOLEAN NOT NULL DEFAULT FALSE,
  es_business     BOOLEAN NOT NULL DEFAULT FALSE,
  categoria       TEXT,
  sitio_web       TEXT,
  last_scraped_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (handle)
);

-- Time series del perfil (un row por día) para gráficas de crecimiento.
CREATE TABLE ig_cuenta_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id     UUID NOT NULL REFERENCES ig_cuentas(id) ON DELETE CASCADE,
  fecha         DATE NOT NULL,
  seguidores    INT NOT NULL,
  seguidos      INT NOT NULL,
  posts_total   INT NOT NULL,
  -- Meta Graph only:
  alcance       INT,
  impresiones   INT,
  profile_views INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cuenta_id, fecha)
);
CREATE INDEX ix_ig_cuenta_snapshots_fecha ON ig_cuenta_snapshots(fecha);

CREATE TABLE ig_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         UUID NOT NULL REFERENCES ig_cuentas(id) ON DELETE CASCADE,
  ig_shortcode      TEXT NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo IN ('image','carousel','video','reel')),
  caption           TEXT,
  url               TEXT NOT NULL,
  thumbnail_url     TEXT,
  publicado_en      TIMESTAMPTZ NOT NULL,
  hashtags          TEXT[] NOT NULL DEFAULT '{}',
  menciones         TEXT[] NOT NULL DEFAULT '{}',
  ubicacion         TEXT,
  duracion_seg      INT,
  likes             INT NOT NULL DEFAULT 0,
  comentarios       INT NOT NULL DEFAULT 0,
  reproducciones    INT,
  -- Meta Graph only:
  guardados         INT,
  compartidos       INT,
  alcance           INT,
  impresiones       INT,
  last_scraped_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cuenta_id, ig_shortcode)
);
CREATE INDEX ix_ig_posts_publicado ON ig_posts(publicado_en DESC);
CREATE INDEX ix_ig_posts_hashtags  ON ig_posts USING GIN (hashtags);

-- Histórico de métricas por post (curvas de crecimiento + preserva datos de posts borrados).
CREATE TABLE ig_post_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         UUID NOT NULL REFERENCES ig_posts(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL,
  likes           INT NOT NULL,
  comentarios     INT NOT NULL,
  reproducciones  INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, fecha)
);

CREATE TABLE ig_comentarios (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id              UUID NOT NULL REFERENCES ig_posts(id) ON DELETE CASCADE,
  ig_comment_id        TEXT NOT NULL,
  autor_handle         TEXT NOT NULL,
  autor_verificado     BOOLEAN NOT NULL DEFAULT FALSE,
  texto                TEXT NOT NULL,
  likes                INT NOT NULL DEFAULT 0,
  publicado_en         TIMESTAMPTZ NOT NULL,
  es_respuesta         BOOLEAN NOT NULL DEFAULT FALSE,
  parent_comment_id    TEXT,
  respondido           BOOLEAN NOT NULL DEFAULT FALSE,
  -- Análisis (fase 2 — LLM opcional):
  sentimiento          TEXT CHECK (sentimiento IN ('positivo','neutral','negativo')),
  es_pregunta          BOOLEAN,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, ig_comment_id)
);
CREATE INDEX ix_ig_comentarios_post      ON ig_comentarios(post_id);
CREATE INDEX ix_ig_comentarios_publicado ON ig_comentarios(publicado_en DESC);

-- Configuración de scraping por cuenta (posts/comentarios por run, toggle cron, cooldown manual).
CREATE TABLE ig_config (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id              UUID NOT NULL UNIQUE REFERENCES ig_cuentas(id) ON DELETE CASCADE,
  posts_por_run          INT NOT NULL DEFAULT 30,
  comentarios_por_post   INT NOT NULL DEFAULT 50,
  cron_activado          BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_refresh_manual  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
