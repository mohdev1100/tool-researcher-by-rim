// JSON API reader driven by a small path mapping in sources.json:
//   "api": { "items": "result.results", "title": "title", "url": "url", "date": "docdt", ... }
// A path is dotted ("a.b.0.c"); a value may be an array of alternative paths (first non-empty wins);
// a value starting with "=" is a literal.

import { clean, decodeEntities, truncate } from './text.mjs'
import { parseDate } from './dates.mjs'

export function getPath(obj, path) {
  if (path == null || path === '') return obj
  let cur = obj
  for (const p of String(path).split('.')) {
    if (cur == null) return undefined
    if (p === '*') { cur = Array.isArray(cur) ? cur : Object.values(cur); continue }
    cur = cur[p]
  }
  return cur
}

function pick(row, spec) {
  if (spec == null) return undefined
  for (const s of Array.isArray(spec) ? spec : [spec]) {
    if (typeof s === 'string' && s.startsWith('=')) return s.slice(1)
    const v = getPath(row, s)
    if (v == null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    return v
  }
  return undefined
}

export function asText(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return asText(v[0])
  if (typeof v === 'object') {
    for (const k of ['name', 'title', 'display_name', 'label', 'value', 'url', 'href', 'text', 'en', 'fr', 'ar']) {
      if (v[k] != null && v[k] !== '') return asText(v[k])
    }
    return ''
  }
  return String(v)
}

function asList(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(asText).filter(Boolean)
  if (typeof v === 'object') return Object.values(v).map(asText).filter(Boolean)
  return String(v).split(/[,;|]/).map(s => s.trim()).filter(Boolean)
}

/**
 * Parse an API response into items. `map` is the source's "api" mapping.
 */
export function parseApi(json, map) {
  if (!map) return []
  let list = getPath(json, map.items)
  if (list && !Array.isArray(list) && typeof list === 'object') list = Object.values(list)
  if (!Array.isArray(list)) return []
  const out = []
  for (const row of list) {
    if (row == null || typeof row !== 'object') continue
    const title = clean(decodeEntities(asText(pick(row, map.title))))
    let url = asText(pick(row, map.url)).trim()
    if (url && map.url_prefix && !/^https?:\/\//i.test(url)) url = map.url_prefix + url
    let file = asText(pick(row, map.file)).trim()
    if (file && map.file_prefix && !/^https?:\/\//i.test(file)) file = map.file_prefix + file
    const date = parseDate(pick(row, map.date))
    const summary = truncate(clean(decodeEntities(asText(pick(row, map.summary)))), 600)
    const type = clean(asText(pick(row, map.type)))
    const lang = clean(asText(pick(row, map.lang)))
    const publisher = clean(asText(pick(row, map.publisher)))
    const tags = asList(pick(row, map.tags))
    const author = clean(asText(pick(row, map.author)))
    if (!title) continue
    if (!url && !file) continue
    out.push({ title, url: url || file, file, date, summary, type, lang, publisher, tags, author })
  }
  return out
}
