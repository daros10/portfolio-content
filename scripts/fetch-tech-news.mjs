// Genera content/tech-news.json a partir de una lista curada de feeds RSS/Atom de tecnología
// (IA, nube, frontend, mobile, backend, lenguajes, herramientas). Pensado para correr a diario desde
// .github/workflows/tech-news.yml — ver ese workflow para el cron.
//
// Uso: node scripts/fetch-tech-news.mjs
// Salida: content/tech-news.json ({ generatedAt, items: TechNewsItem[] })
//
// TechNewsItem (debe coincidir con src/content/types.ts del repo del portfolio):
//   { id, title, url, source, category, publishedAt, imageUrl? }
//
// `imageUrl` es opcional a propósito: fuentes de alto volumen como AWS (sin og:image) y OpenAI
// (bloquea bots con 403) nunca la tendrán. El frontend cae a un placeholder por categoría cuando
// falta — ver CATEGORY_STYLE en src/sections/TechRadar.tsx del repo del portfolio.

import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Parser from 'rss-parser'

const rootDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const outFile = path.join(rootDir, 'content', 'tech-news.json')

const MAX_AGE_DAYS = 90
const MAX_ITEMS_PER_SOURCE = 3
const CATEGORY_QUOTA = 8
const MAX_TOTAL_ITEMS = 48
const MIN_ITEMS_TO_PUBLISH = 5
const FETCH_TIMEOUT_MS = 15000
const UA = 'Mozilla/5.0 (compatible; portfolio-content-bot/1.0)'

// Fallback de imagen vía og:image: solo se ejecuta sobre los ítems ya seleccionados (no sobre los
// cientos de items crudos), con concurrencia limitada y leyendo solo el head del HTML.
const OG_IMAGE_TIMEOUT_MS = 8000
const OG_IMAGE_CONCURRENCY = 8
const OG_IMAGE_MAX_BYTES = 200 * 1024

// Lista curada de feeds. `defaultCategory` se usa salvo que el título matchee una palabra clave más
// específica (ver `reclassify` abajo) — así un post de AWS sobre un LLM cae en "ai", no en "cloud".
//
// Notas de feeds que se probaron y no funcionan, para no volver a intentarlos sin motivo:
// - Anthropic no publica un feed RSS/Atom público a la fecha de escritura de este script.
// - InfoQ devuelve 406 incluso con User-Agent de navegador.
// - `https://swift.org/atom.xml` no es XML válido; se usa el feed de anuncios del foro en su lugar.
const FEEDS = [
  // IA
  { url: 'https://openai.com/news/rss.xml', source: 'OpenAI', defaultCategory: 'ai' },
  { url: 'https://blog.google/technology/ai/rss/', source: 'Google AI Blog', defaultCategory: 'ai' },
  { url: 'https://huggingface.co/blog/feed.xml', source: 'Hugging Face', defaultCategory: 'ai' },
  { url: 'https://deepmind.google/blog/rss.xml', source: 'DeepMind', defaultCategory: 'ai' },

  // Nube
  { url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', source: 'AWS', defaultCategory: 'cloud' },
  { url: 'https://cloudblog.withgoogle.com/rss/', source: 'Google Cloud Blog', defaultCategory: 'cloud' },
  { url: 'https://azure.microsoft.com/en-us/blog/feed/', source: 'Azure', defaultCategory: 'cloud' },
  { url: 'https://blog.cloudflare.com/rss/', source: 'Cloudflare Blog', defaultCategory: 'cloud' },

  // Frontend
  { url: 'https://react.dev/rss.xml', source: 'React Blog', defaultCategory: 'frontend' },
  { url: 'https://blog.vuejs.org/feed.rss', source: 'Vue Blog', defaultCategory: 'frontend' },
  { url: 'https://blog.angular.dev/feed', source: 'Angular Blog', defaultCategory: 'frontend' },
  { url: 'https://web.dev/feed.xml', source: 'web.dev', defaultCategory: 'frontend' },
  { url: 'https://developer.chrome.com/blog/feed.xml', source: 'Chrome Developers', defaultCategory: 'frontend' },
  { url: 'https://www.smashingmagazine.com/feed/', source: 'Smashing Magazine', defaultCategory: 'frontend' },
  { url: 'https://css-tricks.com/feed/', source: 'CSS-Tricks', defaultCategory: 'frontend' },
  { url: 'https://astro.build/rss.xml', source: 'Astro Blog', defaultCategory: 'frontend' },

  // Mobile
  {
    url: 'https://android-developers.googleblog.com/feeds/posts/default',
    source: 'Android Developers',
    defaultCategory: 'mobile',
  },
  { url: 'https://developer.apple.com/news/rss/news.rss', source: 'Apple Developer', defaultCategory: 'mobile' },
  { url: 'https://medium.com/feed/flutter', source: 'Flutter', defaultCategory: 'mobile' },
  { url: 'https://reactnative.dev/blog/rss.xml', source: 'React Native', defaultCategory: 'mobile' },
  { url: 'https://blog.jetbrains.com/kotlin/feed/', source: 'Kotlin Blog', defaultCategory: 'mobile' },
  {
    url: 'https://forums.swift.org/c/announcements/6.rss',
    source: 'Swift Forums',
    defaultCategory: 'mobile',
  },

  // Backend
  { url: 'https://nodejs.org/en/feed/blog.xml', source: 'Node.js Blog', defaultCategory: 'backend' },
  { url: 'https://spring.io/blog.atom', source: 'Spring Blog', defaultCategory: 'backend' },
  { url: 'https://kubernetes.io/feed.xml', source: 'Kubernetes Blog', defaultCategory: 'backend' },

  // Lenguajes
  { url: 'https://blog.rust-lang.org/feed.xml', source: 'Rust Blog', defaultCategory: 'languages' },
  { url: 'https://go.dev/blog/feed.atom', source: 'Go Blog', defaultCategory: 'languages' },
  {
    url: 'https://devblogs.microsoft.com/typescript/feed/',
    source: 'TypeScript DevBlog',
    defaultCategory: 'languages',
  },
  { url: 'https://pythoninsider.blogspot.com/feeds/posts/default', source: 'Python Insider', defaultCategory: 'languages' },

  // Herramientas
  { url: 'https://github.blog/feed/', source: 'GitHub Blog', defaultCategory: 'tools' },
  { url: 'https://www.docker.com/blog/feed/', source: 'Docker Blog', defaultCategory: 'tools' },
  { url: 'https://stackoverflow.blog/feed/', source: 'Stack Overflow Blog', defaultCategory: 'tools' },
  { url: 'https://netflixtechblog.com/feed', source: 'Netflix Tech', defaultCategory: 'tools' },
]

// Palabras clave que reclasifican un item aunque su feed de origen sea de otra categoría por
// defecto (p. ej. un post de AWS sobre un modelo de lenguaje debería aparecer como "ai"). El orden
// importa: se evalúan en secuencia y gana el primer match, por eso "mobile" va antes que "frontend"
// (así "React Native" no cae en frontend por el término genérico "react").
const CATEGORY_KEYWORDS = [
  { category: 'ai', pattern: /\b(ai|llm|gpt|claude|gemini|model|agent|machine learning|neural)\b/i },
  {
    category: 'mobile',
    pattern: /\b(android|ios|flutter|jetpack compose|swiftui|react native|xcode|app store|google play)\b/i,
  },
  { category: 'cloud', pattern: /\b(aws|azure|gcp|cloud|kubernetes|serverless|lambda)\b/i },
  { category: 'languages', pattern: /\b(rust|golang|typescript|python|java|c\+\+|kotlin|swift)\b/i },
  { category: 'frontend', pattern: /\b(angular|vue\.?js|react|next\.?js|svelte|css|html|browser)\b/i },
]

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { 'User-Agent': UA },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded'],
    ],
  },
})

function isHttpsUrl(url) {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function reclassify(title, defaultCategory) {
  for (const { category, pattern } of CATEGORY_KEYWORDS) {
    if (pattern.test(title)) return category
  }
  return defaultCategory
}

function normalizeUrl(url) {
  try {
    const u = new URL(url)
    u.hash = ''
    u.search = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

function shortHash(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

/**
 * Extrae una imagen del propio item de RSS/Atom, en orden de preferencia. Devuelve null si el feed
 * no trae ninguna (el fallback de red vía og:image se intenta después, solo para los items
 * finalmente seleccionados — ver `fetchOgImage`).
 */
function extractImage(item) {
  const enclosureUrl = item.enclosure?.url
  if (enclosureUrl && isHttpsUrl(enclosureUrl)) {
    const type = item.enclosure.type ?? ''
    if (!type || type.startsWith('image/')) return enclosureUrl
  }

  const thumbnailUrl = item.mediaThumbnail?.$?.url
  if (thumbnailUrl && isHttpsUrl(thumbnailUrl)) return thumbnailUrl

  const mediaContent = item.mediaContent
  if (mediaContent) {
    const candidates = Array.isArray(mediaContent) ? mediaContent : [mediaContent]
    for (const candidate of candidates) {
      const url = candidate?.$?.url
      const medium = candidate?.$?.medium
      if (url && isHttpsUrl(url) && (!medium || medium === 'image')) return url
    }
  }

  const html = item.contentEncoded ?? item.content ?? ''
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (match && isHttpsUrl(match[1])) return match[1]

  return null
}

/** Descarga solo los primeros ~200KB de la página del artículo y busca og:image / twitter:image. */
async function fetchOgImage(url) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OG_IMAGE_TIMEOUT_MS)
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } })
    clearTimeout(timer)
    if (!response.ok || !response.body) return null

    const reader = response.body.getReader()
    const chunks = []
    let received = 0
    while (received < OG_IMAGE_MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
    }
    reader.cancel().catch(() => {})

    const html = Buffer.concat(chunks).toString('utf-8')
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)

    return match && isHttpsUrl(match[1]) ? match[1] : null
  } catch {
    return null
  }
}

async function mapWithConcurrency(items, limit, fn) {
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function fetchFeed({ url, source, defaultCategory }) {
  const feed = await parser.parseURL(url)
  return (feed.items ?? [])
    .filter((item) => item.title && item.link)
    .map((item) => {
      const publishedAt = item.isoDate ?? (item.pubDate ? new Date(item.pubDate).toISOString() : null)
      if (!publishedAt) return null
      const imageUrl = extractImage(item)
      return {
        id: shortHash(normalizeUrl(item.link)),
        title: item.title.trim(),
        url: item.link,
        source,
        category: reclassify(item.title, defaultCategory),
        publishedAt,
        ...(imageUrl ? { imageUrl } : {}),
      }
    })
    .filter(Boolean)
}

function weeksAgo(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (7 * 24 * 60 * 60 * 1000))
}

/**
 * Orden de preferencia: primero por semana de antigüedad (más fresco gana), y solo dentro de la
 * misma semana se prioriza tener imagen — así una noticia con imagen de hace 3 meses nunca le gana a
 * una sin imagen de ayer.
 */
function compareItems(a, b) {
  const weekDiff = weeksAgo(a.publishedAt) - weeksAgo(b.publishedAt)
  if (weekDiff !== 0) return weekDiff
  const imageDiff = (b.imageUrl ? 1 : 0) - (a.imageUrl ? 1 : 0)
  if (imageDiff !== 0) return imageDiff
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
}

/**
 * Selecciona hasta MAX_TOTAL_ITEMS respetando una cuota por categoría, para que categorías con
 * pocos posts (mobile, frontend) no queden ahogadas por las más prolíficas (ai, cloud). Los cupos
 * sobrantes de categorías con pocos items se rellenan globalmente por orden de preferencia.
 */
function selectWithCategoryQuota(items) {
  const ordered = [...items].sort(compareItems)
  const selected = []
  const leftover = []
  const perCategoryCount = new Map()

  for (const item of ordered) {
    if (selected.length >= MAX_TOTAL_ITEMS) {
      leftover.push(item)
      continue
    }
    const count = perCategoryCount.get(item.category) ?? 0
    if (count < CATEGORY_QUOTA) {
      selected.push(item)
      perCategoryCount.set(item.category, count + 1)
    } else {
      leftover.push(item)
    }
  }

  if (selected.length < MAX_TOTAL_ITEMS) {
    selected.push(...leftover.slice(0, MAX_TOTAL_ITEMS - selected.length))
  }

  return selected.sort(compareItems)
}

async function main() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed))

  let items = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
    } else {
      console.warn(`Feed falló: ${FEEDS[index].source} (${FEEDS[index].url}) — ${result.reason?.message ?? result.reason}`)
    }
  })

  // Filtrar por antigüedad
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  items = items.filter((item) => new Date(item.publishedAt).getTime() >= cutoff)

  // Deduplicar por URL normalizada y por título
  const seenUrls = new Set()
  const seenTitles = new Set()
  items = items.filter((item) => {
    const normUrl = normalizeUrl(item.url)
    const normTitle = item.title.toLowerCase().trim()
    if (seenUrls.has(normUrl) || seenTitles.has(normTitle)) return false
    seenUrls.add(normUrl)
    seenTitles.add(normTitle)
    return true
  })

  // Máximo N items por fuente, para que ninguna fuente domine el feed (se queda con los más
  // recientes de cada fuente).
  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  const perSourceCount = new Map()
  items = items.filter((item) => {
    const count = perSourceCount.get(item.source) ?? 0
    if (count >= MAX_ITEMS_PER_SOURCE) return false
    perSourceCount.set(item.source, count + 1)
    return true
  })

  let selected = selectWithCategoryQuota(items)

  // Fallback de imagen: solo para los ítems finalmente seleccionados que no trajeron una del feed.
  await mapWithConcurrency(
    selected.filter((item) => !item.imageUrl),
    OG_IMAGE_CONCURRENCY,
    async (item) => {
      const imageUrl = await fetchOgImage(item.url)
      if (imageUrl) item.imageUrl = imageUrl
    }
  )

  if (selected.length < MIN_ITEMS_TO_PUBLISH) {
    console.error(
      `Solo se obtuvieron ${selected.length} items (mínimo ${MIN_ITEMS_TO_PUBLISH}). No se sobrescribe tech-news.json — se conserva el feed del día anterior.`
    )
    process.exitCode = 1
    return
  }

  const feed = { generatedAt: new Date().toISOString(), items: selected }

  await mkdir(path.dirname(outFile), { recursive: true })
  await writeFile(outFile, JSON.stringify(feed, null, 2) + '\n')

  const withImage = selected.filter((item) => item.imageUrl).length
  console.log(`tech-news.json actualizado con ${selected.length} items (${withImage} con imagen).`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
