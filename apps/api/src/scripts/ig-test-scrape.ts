/**
 * Script de prueba del scraper de Instagram vía Apify.
 *
 * Uso (desde la raíz del monorepo):
 *   pnpm --filter @antigravity/api tsx src/scripts/ig-test-scrape.ts <handle> [posts_limit]
 *
 * Ejemplos:
 *   pnpm --filter @antigravity/api tsx src/scripts/ig-test-scrape.ts natgeo 3
 *   pnpm --filter @antigravity/api tsx src/scripts/ig-test-scrape.ts nalu.boutique 3
 */

import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
// El .env vive en la raíz del monorepo — 4 niveles arriba de src/scripts/
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })
import { scrapeIgProfile, scrapeIgProfileOnly } from '../lib/apify/scraper.js'

const handle = process.argv[2]
const postsLimit = parseInt(process.argv[3] ?? '3', 10)

if (!handle) {
  console.error('❌  Uso: pnpm --filter @antigravity/api tsx src/scripts/ig-test-scrape.ts <handle> [posts_limit]')
  process.exit(1)
}

const token = process.env.APIFY_TOKEN
if (!token || token === 'REEMPLAZA_CON_TU_NUEVO_TOKEN') {
  console.error('❌  Falta APIFY_TOKEN en .env (raíz del monorepo)')
  process.exit(1)
}

const actor = process.env.APIFY_DEFAULT_ACTOR ?? 'apify/instagram-scraper'

console.log(`\n🔍  Validando perfil @${handle}...`)
try {
  const profile = await scrapeIgProfileOnly(handle, token, actor)
  if (!profile) {
    console.error('❌  No se encontró la cuenta. Verifica el handle.')
    process.exit(1)
  }
  console.log('✅  Perfil encontrado:')
  console.table({
    handle: profile.handle,
    displayName: profile.displayName,
    seguidores: profile.followersCount,
    seguidos: profile.followingCount,
    posts: profile.postsCount,
    verificada: profile.verified,
    privada: profile.isPrivate,
    categoria: profile.categoria ?? '—',
  })
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'PRIVATE_ACCOUNT') {
    console.error('❌  La cuenta es privada — el scraper no puede leerla.')
  } else {
    console.error('❌  Error validando perfil:', msg)
  }
  process.exit(1)
}

console.log(`\n📸  Trayendo últimos ${postsLimit} posts + comentarios...`)
const result = await scrapeIgProfile(handle, token, actor, {
  postsLimit,
  comentariosLimit: 10,
})

console.log(`\n✅  Posts obtenidos: ${result.posts.length}`)
for (const post of result.posts) {
  const comentarios = post.latestComments?.length ?? 0
  console.log(
    `  • [${post.type.padEnd(8)}] ${post.shortCode}` +
    `  ❤️  ${String(post.likesCount).padStart(6)}  💬 ${String(post.commentsCount).padStart(4)}` +
    ` (${comentarios} traídos)  📅 ${post.timestamp.slice(0, 10)}`,
  )
  if (post.caption) {
    const preview = post.caption.slice(0, 90).replace(/\n/g, ' ')
    console.log(`    "${preview}${post.caption.length > 90 ? '…' : ''}"`)
  }
}

if (result.posts[0]?.latestComments?.length) {
  console.log('\n💬  Primer comentario del post más reciente:')
  const c = result.posts[0].latestComments[0]!
  console.log(`    @${c.ownerUsername}: "${c.text.slice(0, 120)}"`)
}

console.log('\n🎉  Todo OK — el scraper funciona correctamente.')
