-- Migración 026 — apartamento del cliente.
--
-- El primer negocio que usa esto le vende a los vecinos de su propio edificio,
-- y no identifica a la gente por el nombre sino por el apartamento: "el 502"
-- antes que "María". Con solo `direccion` y `ciudad` el dato más útil del
-- cliente no tenía dónde vivir, y la lista de pedidos obligaba a leer nombres
-- completos para encontrar uno.
--
-- Por qué una columna aparte y no reusar `direccion`: son dos datos distintos
-- con dos usos distintos. `direccion` es la dirección larga (y para un negocio
-- que reparte en un solo edificio es la MISMA para todos, así que no distingue
-- nada); `apartamento` es la etiqueta corta por la que se busca y que se
-- muestra junto al pedido. Meterlos en un solo campo obligaría a parsear texto
-- libre para sacar lo único que importa.
--
-- Sin CHECK a propósito: "502", "Torre 3 - 1204", "Casa 2" y "Apto 4B" son
-- todos válidos según cómo esté organizado el conjunto. Validar formato acá
-- solo serviría para rechazar la forma en que un negocio real numera.
--
-- La columna es global (igual que `sprite` en la 024) pero la INTERFAZ que la
-- usa va detrás de `config_empresa.tema = '8bit'`: un negocio que le vende a
-- empresas no tiene por qué ver un campo "apartamento" en su formulario. Ver
-- el comentario de la 025.

ALTER TABLE clientes ADD COLUMN IF NOT EXISTS apartamento TEXT;

-- Se busca por apartamento tanto como por nombre. El índice es sobre
-- lower(apartamento) porque la búsqueda es case-insensitive ("apto 4b" debe
-- encontrar "Apto 4B"), y parcial porque la enorme mayoría de tenants nunca
-- va a llenar esta columna — no tiene sentido indexar millones de NULL.
CREATE INDEX IF NOT EXISTS idx_clientes_apartamento
  ON clientes (lower(apartamento))
  WHERE apartamento IS NOT NULL AND deleted_at IS NULL;
