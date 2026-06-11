/**
 * DTOs del payload devuelto por el actor `apify/instagram-scraper`.
 * Solo los campos que realmente usamos — Apify devuelve más, pero
 * TypeScript los ignora si no están declarados aquí.
 */

export interface ApifyIgComment {
  id: string
  text: string
  ownerUsername: string
  ownerVerified?: boolean
  likesCount: number | string
  timestamp: string // ISO-8601
  replies?: ApifyIgComment[]
}

export interface ApifyIgPost {
  id: string
  shortCode: string
  url: string
  /** 'Image' | 'Video' | 'Sidecar' (carousel) */
  type: string
  caption: string | null
  timestamp: string // ISO-8601
  likesCount: number | string
  commentsCount: number | string
  videoViewCount: number | string | null
  displayUrl: string | null
  hashtags: string[]
  mentions: string[]
  locationName: string | null
  videoDuration: number | string | null
  // Perfil del dueño (presente cuando addParentData: true)
  ownerUsername: string
  ownerFullName: string | null
  ownerFollowersCount: number | string | null  // Apify puede devolver "89.093" (miles con punto)
  ownerVerified?: boolean
  // Comentarios (presente cuando scrapeComments: true)
  latestComments?: ApifyIgComment[]
}

export interface ApifyIgProfileDetail {
  username: string
  fullName: string | null
  biography: string | null
  profilePicUrl: string | null
  followersCount: number | string
  followingCount: number | string
  postsCount: number | string
  verified?: boolean
  businessCategoryName: string | null
  externalUrl: string | null
  id: string | null
  private: boolean
}
