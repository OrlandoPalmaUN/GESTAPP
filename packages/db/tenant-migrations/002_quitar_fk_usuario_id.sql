-- La tabla `usuarios` de cada schema de tenant ("perfiles internos del
-- negocio") nunca se llena — la fuente de verdad de usuarios es el schema
-- PÚBLICO (`public.usuarios`, gestionado por Prisma/el módulo de auth). Las
-- columnas `usuario_id` de `movimientos_inventario` y `pedidos` SÍ deben
-- guardar el id del usuario logueado (auditoría: "quién hizo este movimiento/
-- pedido"), pero ese id vive en `public.usuarios`, no en el `usuarios` local
-- — así que la FK contra la tabla local SIEMPRE fallaba (23503) en cuanto se
-- intentaba registrar la auditoría con un usuario real.
--
-- Solución: la columna se queda (sigue sirviendo para trazabilidad/joins
-- manuales contra `public.usuarios` si hiciera falta), pero sin members FK
-- hacia una tabla que nunca tendrá filas correspondientes.
ALTER TABLE movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_usuario_id_fkey;
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_usuario_id_fkey;
