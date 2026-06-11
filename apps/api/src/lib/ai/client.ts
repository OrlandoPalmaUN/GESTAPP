import Groq from 'groq-sdk'

let _groq: Groq | null = null

export function getGroq(apiKey: string): Groq {
  if (!_groq) _groq = new Groq({ apiKey })
  return _groq
}

export const AI_MODEL = 'llama-3.3-70b-versatile'
