-- Migración 008 — "cargos libres" en pedidos: ítems dinámicos que NO están
-- en el catálogo de productos (el caso típico es Envío). Hasta ahora cada
-- línea de un pedido obligatoriamente referenciaba un producto; esto agrega
-- una segunda forma de línea identificada por `concepto` (texto libre, p.ej.
-- "Envío") en vez de `producto_id`.
--
-- `producto_id` pasa a ser opcional y se agrega `concepto`; un CHECK
-- garantiza que sea exactamente uno de los dos (nunca ninguno, nunca ambos
-- — evita filas ambiguas).

ALTER TABLE pedido_items ALTER COLUMN producto_id DROP NOT NULL;
ALTER TABLE pedido_items ADD COLUMN concepto TEXT;
ALTER TABLE pedido_items ADD CONSTRAINT pedido_items_producto_xor_concepto
  CHECK ((producto_id IS NOT NULL) <> (concepto IS NOT NULL));
