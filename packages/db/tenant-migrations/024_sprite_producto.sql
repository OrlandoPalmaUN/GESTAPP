-- Migración 024 — ilustración (sprite) por producto.
--
-- El inventario solo se podía leer como números en una tabla. Para negocios
-- con pocos productos y cantidades bajas (una tienda de barrio, un puesto de
-- lácteos) es mucho más rápido VER cuánto queda que leerlo: la vista "Vitrina"
-- dibuja la existencia como piezas contables, y necesita saber qué dibujar.
--
--   sprite        Clave del catálogo de ilustraciones que resuelve el front
--                 (ver `SPRITES_PRODUCTO` en @antigravity/shared y
--                 apps/web/components/sprites). NULL = caja genérica.
--                 Se guarda la CLAVE, no la imagen: los sprites son SVG
--                 versionados en el repo, así que recolorearlos o redibujarlos
--                 no obliga a migrar datos.
--
--   sprite_escala Cuántas unidades representa cada pieza dibujada. NULL = 1.
--                 Existe porque 30 arepas como 30 dibujos no se cuentan de un
--                 vistazo: con escala 5 se dibujan 6 piezas y se anota la
--                 equivalencia. Solo afecta a la presentación — el stock real
--                 sigue siendo la suma de `movimientos_inventario`.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS sprite        TEXT,
                      ADD COLUMN IF NOT EXISTS sprite_escala INTEGER;

-- Una escala de 0 o negativa haría una división por cero al calcular cuántas
-- piezas dibujar. NULL sigue permitido (equivale a 1).
ALTER TABLE productos DROP CONSTRAINT IF EXISTS sprite_escala_positiva;
ALTER TABLE productos ADD CONSTRAINT sprite_escala_positiva
  CHECK (sprite_escala IS NULL OR sprite_escala > 0);
