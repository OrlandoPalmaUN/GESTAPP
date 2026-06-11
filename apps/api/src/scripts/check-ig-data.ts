/**
 * Inspecciona los datos de IG guardados para un tenant.
 * Uso: cd apps/api && pnpm tsx src/scripts/check-ig-data.ts [schema]
 */
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import pkg from 'pg'
const { Pool } = pkg

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: resolve(__dirname, '../../../../.env') })

const schemaName = process.argv[2] ?? 'tenant_nalu'
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const client = await pool.connect()
await client.query(`SET search_path TO "${schemaName}", public`)

const r = await client.query(`
  SELECT tipo, ig_shortcode, likes, comentarios, reproducciones, publicado_en::date as fecha
  FROM ig_posts
  ORDER BY publicado_en DESC
  LIMIT 20
`)
console.log('Posts (tipo | shortcode | likes | comentarios | reproducciones | fecha):')
r.rows.forEach(p =>
  console.log(` ${p.tipo.padEnd(8)} | ${p.ig_shortcode.padEnd(12)} | ${String(p.likes).padStart(6)} | ${String(p.comentarios).padStart(5)} | ${String(p.reproducciones ?? 'NULL').padStart(12)} | ${p.fecha}`)
)

const r2 = await client.query(`
  SELECT tipo, COUNT(*) as total,
         SUM(CASE WHEN reproducciones IS NOT NULL THEN 1 ELSE 0 END) as con_views,
         AVG(reproducciones)::int as avg_views
  FROM ig_posts GROUP BY tipo ORDER BY tipo
`)
console.log('\nResumen por tipo:')
r2.rows.forEach(r => console.log(` ${r.tipo}: ${r.total} posts, ${r.con_views} con views, avg ${r.avg_views ?? '—'}`)
)

await client.query('RESET search_path')
client.release()
await pool.end()
