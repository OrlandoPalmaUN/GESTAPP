-- Migración 001 — tablas "core" del schema de cada tenant (plan §9).
-- Se aplica dentro del schema del tenant (el runner hace `SET search_path`
-- antes de ejecutar este archivo) — por eso los nombres de tabla van sin
-- prefijo de schema.
--
-- Orden importante: las tablas con FKs van después de sus referenciadas.

-- Usuarios "operativos" del tenant (distintos de `public.usuarios`, que son
-- las cuentas de la plataforma — superadmin/admin/usuario). Estos son los
-- perfiles internos del negocio: quién registró cada movimiento, pedido, etc.
CREATE TABLE usuarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  rol         TEXT NOT NULL DEFAULT 'operador', -- admin | operador | solo_lectura
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Categorías de producto (referenciada por `productos.categoria_id` en el
-- plan original, pero su CREATE TABLE no quedó documentado — se agrega aquí
-- como tabla mínima para que la FK sea válida).
CREATE TABLE categorias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Productos
CREATE TABLE productos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             TEXT UNIQUE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  categoria_id    UUID REFERENCES categorias(id),
  precio_costo    NUMERIC(12,2),
  precio_venta    NUMERIC(12,2),
  unidad          TEXT NOT NULL DEFAULT 'unidad',
  stock_minimo    NUMERIC(12,2) NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Movimientos de inventario (fuente de verdad del stock)
CREATE TABLE movimientos_inventario (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id     UUID NOT NULL REFERENCES productos(id),
  tipo            TEXT NOT NULL,      -- entrada_compra | salida_venta | ajuste_positivo | etc.
  cantidad        NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2),
  referencia_tipo TEXT,               -- 'pedido' | 'factura_compra' | 'ajuste'
  referencia_id   UUID,               -- ID del documento de origen
  notas           TEXT,
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clientes
CREATE TABLE clientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  nit         TEXT UNIQUE,
  email       TEXT,
  telefono    TEXT,
  direccion   TEXT,
  ciudad      TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pedidos
CREATE TABLE pedidos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          TEXT NOT NULL UNIQUE,   -- Auto-generado: PED-2024-0001
  cliente_id      UUID REFERENCES clientes(id),
  estado          TEXT NOT NULL DEFAULT 'borrador',
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas           TEXT,
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ítems de pedido
CREATE TABLE pedido_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id     UUID NOT NULL REFERENCES productos(id),
  cantidad        NUMERIC(12,2) NOT NULL,
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED
);

-- Facturas de venta (CxC)
CREATE TABLE facturas_venta (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            TEXT NOT NULL UNIQUE,
  cliente_id        UUID REFERENCES clientes(id),
  pedido_id         UUID REFERENCES pedidos(id),
  fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,
  total             NUMERIC(12,2) NOT NULL,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Abonos (tanto para CxC como CxP)
CREATE TABLE abonos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento  TEXT NOT NULL,    -- 'factura_venta' | 'factura_compra'
  documento_id    UUID NOT NULL,
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  medio_pago      TEXT,             -- efectivo | transferencia | cheque | tarjeta
  referencia      TEXT,             -- número de comprobante
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de soporte para los filtros/joins más comunes (plan §5).
CREATE INDEX idx_productos_categoria ON productos(categoria_id);
CREATE INDEX idx_movimientos_producto ON movimientos_inventario(producto_id);
CREATE INDEX idx_movimientos_referencia ON movimientos_inventario(referencia_tipo, referencia_id);
CREATE INDEX idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX idx_pedidos_estado ON pedidos(estado);
CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);
CREATE INDEX idx_facturas_cliente ON facturas_venta(cliente_id);
CREATE INDEX idx_abonos_documento ON abonos(tipo_documento, documento_id);
