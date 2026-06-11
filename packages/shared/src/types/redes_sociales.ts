/**
 * Redes Sociales — tipos compartidos entre API y Web.
 * Datos vienen de Apify (scraping público de Instagram).
 * Campos "Meta Graph only" se marcan con comentario — quedan null
 * hasta que el tenant conecte OAuth Business.
 */

export interface IgCuenta {
  id: string
  handle: string
  igUserId: string | null
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  esVerificada: boolean
  esBusiness: boolean
  categoria: string | null
  sitioWeb: string | null
  lastScrapedAt: string | null
  createdAt: string
  // snapshot más reciente (se une en el GET /cuenta)
  seguidores?: number | null
  seguidos?: number | null
  postsTotal?: number | null
  snapshotFecha?: string | null
}

export interface IgResumen {
  handle: string
  displayName: string | null
  seguidores: number
  seguidos: number
  postsTotal: number
  deltaSeguidores: number        // variación neta en el período
  erPromedio: number             // engagement rate promedio (likes+comentarios / seguidores * 100)
  totalPosts: number             // posts publicados en el período
  totalComentarios: number       // comentarios recibidos en el período
}

export interface IgPost {
  id: string
  igShortcode: string
  tipo: 'image' | 'carousel' | 'video' | 'reel'
  caption: string | null
  url: string
  thumbnailUrl: string | null
  publicadoEn: string
  likes: number
  comentarios: number
  reproducciones: number | null
  hashtags: string[]
  lastScrapedAt: string
}

export interface IgPostDetalle extends IgPost {
  menciones: string[]
  ubicacion: string | null
  duracionSeg: number | null
  // Meta Graph only:
  guardados: number | null
  alcance: number | null
  impresiones: number | null
}

export interface IgPostSnapshot {
  fecha: string
  likes: number
  comentarios: number
  reproducciones: number | null
}

export interface IgComentario {
  id: string
  postId: string
  igCommentId: string
  autorHandle: string
  autorVerificado: boolean
  texto: string
  likes: number
  publicadoEn: string
  esRespuesta: boolean
  respondido: boolean
  sentimiento: 'positivo' | 'neutral' | 'negativo' | null
  esPregunta: boolean | null
}

export interface IgSnapshotPerfil {
  fecha: string
  seguidores: number
  seguidos: number
  postsTotal: number
  // Meta Graph only:
  alcance: number | null
  impresiones: number | null
  profileViews: number | null
}

export interface IgHashtagStat {
  hashtag: string
  frecuencia: number
  engagementPromedio: number
}

export interface IgHeatmapPunto {
  diaSemana: number   // 0=Dom … 6=Sáb
  hora: number        // 0-23
  posts: number
  engagementPromedio: number
}

export interface IgRun {
  id: string
  tenantId: string
  actor: string
  apifyRunId: string | null
  trigger: 'cron' | 'manual' | 'backfill'
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  startedAt: string
  finishedAt: string | null
  itemsCount: number | null
  apifyUsageUsd: number | null
  errorMessage: string | null
}
