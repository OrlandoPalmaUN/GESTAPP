-- Migración 025 — tema visual por empresa.
--
-- Las ilustraciones de producto, la Vitrina y el alta rápida con plantillas se
-- construyeron para un negocio concreto (una tienda de lácteos y huevos que
-- vende a vecinos) y se habían activado para TODOS los tenants. El resultado
-- era que una tienda de ropa abría "Nuevo Producto" y le aparecían plantillas
-- de queso costeño y suero.
--
-- `tema` decide qué interfaz ve cada empresa:
--
--   'default'  Lo de siempre. Es el valor por defecto a propósito: un tenant
--              que no pide nada no debe cambiar de interfaz porque otro sí.
--   '8bit'     Ilustraciones pixel art, Vitrina y alta rápida con plantillas.
--
-- Lo que NO depende del tema son las correcciones: elegir la unidad de venta
-- (la columna y la API ya la soportaban, el formulario nunca la mandaba),
-- las cantidades decimales (un `parseInt` hacía imposible vender media libra)
-- y el subtotal por línea en los pedidos. Eso le sirve a cualquier negocio.

ALTER TABLE config_empresa ADD COLUMN IF NOT EXISTS tema TEXT NOT NULL DEFAULT 'default';

-- Un tema desconocido dejaría la interfaz en un estado que el front no sabe
-- dibujar; preferimos que el UPDATE falle a que la empresa quede rara.
ALTER TABLE config_empresa DROP CONSTRAINT IF EXISTS tema_conocido;
ALTER TABLE config_empresa ADD CONSTRAINT tema_conocido
  CHECK (tema IN ('default', '8bit'));
