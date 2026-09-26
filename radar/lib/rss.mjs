// A small, dependency-free RSS 2.0 / RSS 1.0 / Atom reader.
// Feeds are regular enough that a careful regex pass is more robust here than a strict XML parser
// (many feeds are not well-formed XML anyway).

import { clean, decodeEntities, truncate } from './text.mjs'
import { parseDate } from './dates.mjs'

function unwrapCdata(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

function attr(attrs, name) {
  const m = String(attrs).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : ''
}

/** First non-empty text of any of the given element names (namespaced names allowed). */
function tag(block, names) {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}\\s*>`, 'i')
    const m = block.match(re)
    if (m && m[1].trim()) return unwrapCdata(m[1]).trim()
  }
  return ''
}

function tagAll(block, name) {
  const out = []
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>|<${name}(\\s[^>]*)\\/>`, 'gi')
  for (const m of block.matchAll(re)) {
    const text = m[2] != null ? clean(unwrapCdata(m[2])) : ''
    const attrs = m[1] || m[3] || ''
    out.push({ text, attrs })
  }
  return out
}

function atomLink(block, rel = 'alternate') {
  let fallback = ''
  for (const m of block.matchAll(/<(?:atom:)?link\b([^>]*?)\/?>/gi)) {
    const href = attr(m[1], 'href')
    if (!href) continue
    const r = (attr(m[1], 'rel') || 'alternate').toLowerCase()
    if (r === rel) return href
    if (!fallback && rel === 'alternate') fallback = href
  }
  return fallback
}

function rssLink(block) {
  const plain = block.match(/<link>\s*([^<]+?)\s*<\/link>/i)
  if (plain) return unwrapCdata(plain[1]).trim()
  const cdata = block.match(/<link>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/link>/i)
  if (cdata) return cdata[1].trim()
  const atom = atomLink(block)
  if (atom) return atom
  const guid = block.match(/<guid(\s[^>]*)?>([\s\S]*?)<\/guid>/i)
  if (guid) {
    const g = unwrapCdata(guid[2]).trim()
    if (/^https?:\/\//i.test(g) && !/ispermalink\s*=\s*["']false["']/i.test(guid[1] || '')) return g
  }
  return ''
}

function resolve(href, base) {
  if (!href) return ''
  try { return new URL(href, base || undefined).toString() } catch { return href }
}

function enclosure(block) {
  const enc = block.match(/<enclosure\b([^>]*)\/?>/i)
  if (enc) { const u = attr(enc[1], 'url'); if (u) return { url: u, type: attr(enc[1], 'type') } }
  const media = block.match(/<media:content\b([^>]*)\/?>/i)
  if (media) { const u = attr(media[1], 'url'); if (u) return { url: u, type: attr(media[1], 'type') } }
  const al = atomLink(block, 'enclosure')
  if (al) return { url: al, type: '' }
  return null
}

/**
 * Parse a feed. Returns { title, link, items: [{ title, url, date, summary, categories, file, author }] }.
 */
export function parseFeed(xml, feedUrl = '') {
  const src = String(xml == null ? '' : xml)
  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(src) || (/<entry\b/i.test(src) && !/<item\b/i.test(src))
  const baseAttr = src.match(/xml:base\s*=\s*["']([^"']+)["']/i)
  const head = src.slice(0, src.search(/<(item|entry)\b/i) > 0 ? src.search(/<(item|entry)\b/i) : src.length)
  const channelLink = isAtom ? atomLink(head) : (head.match(/<link>\s*([^<]+?)\s*<\/link>/i) || [])[1] || ''
  const base = (baseAttr && baseAttr[1]) || channelLink || feedUrl || ''
  const feedTitle = clean(tag(head, ['title']))

  const blockRe = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  const items = []
  for (const m of src.matchAll(blockRe)) {
    const b = m[1]
    const title = clean(tag(b, ['title']))
    const url = resolve(isAtom ? atomLink(b) : rssLink(b), base)
    const date = parseDate(clean(tag(b, ['pubDate', 'published', 'dc:date', 'updated', 'issued', 'dc:created', 'lastBuildDate', 'a10:updated', 'prism:publicationDate'])))
    const summary = truncate(clean(tag(b, ['description', 'summary', 'content:encoded', 'content', 'media:description', 'dc:description', 'itunes:summary'])), 600)
    const categories = tagAll(b, 'category').map(c => c.text || attr(c.attrs, 'term') || attr(c.attrs, 'label')).filter(Boolean)
    const enc = enclosure(b)
    const author = clean(tag(b, ['dc:creator', 'author', 'name', 'itunes:author', 'dc:publisher']))
    if (!title && !url) continue
    // `raw` keeps the description's HTML (entities decoded) for per-source regexes such as ReliefWeb's "Source: …" tag.
    const raw = truncate(decodeEntities(tag(b, ['description', 'summary', 'content:encoded', 'content'])), 2500)
    items.push({ title, url, date, summary, raw, categories, file: enc && /pdf/i.test((enc.type || '') + enc.url) ? resolve(enc.url, base) : '', author })
  }
  return { title: feedTitle, link: channelLink, isAtom, items }
}

/** Quick check whether a response body looks like a feed at all. */
export function looksLikeFeed(body) {
  const head = String(body == null ? '' : body).slice(0, 4000)
  return /<rss\b|<feed\b|<rdf:RDF\b|<channel\b/i.test(head)
}
