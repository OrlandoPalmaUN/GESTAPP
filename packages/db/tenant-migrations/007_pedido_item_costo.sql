-- Migración 007 — snapshot del costo en cada línea de pedido, para poder
-- calcular el margen real de la venta (incluso con "precio excepcional"
-- distinto al de catálogo, p.ej. un descuento puntual negociado).
--
-- Por qué un snapshot y no leer `productos.precio_costo` al vuelo: el costo
-- de un producto cambia con el tiempo (nuevas compras, ajustes). Si el
-- margen de un pedido viejo se recalculara con el costo de HOY, la cifra
-- históricamente mostrada cambiaría sola — rompe la trazabilidad contable.
-- Igual que `precio_unitario` (ya es un snapshot del precio de venta), el
-- costo se copia del catálogo al crear el ítem y queda fijo.

ALTER TABLE pedido_items ADD COLUMN precio_costo NUMERIC(12,2);
