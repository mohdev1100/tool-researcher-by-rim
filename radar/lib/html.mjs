// Listing-page reader for publishers with no feed or API.
// Two modes, chosen by the source's "html" block in sources.json:
//   1. "item": a regex with named groups (url, title, date?, summary?, file?) applied globally to the page.
//   2. "link": a regex that a link's href must match; the title is the anchor text and the date is the
//      nearest date found around the anchor. Optional "exclude", "section" / "section_end" (regexes that
//      slice the page), "date_side" ('after' | 'before' | 'both'), "date_window" (chars), "title_min".

import { clean, decodeEntities, normalizeUrl, truncate } from './text.mjs'
import { allDates, findDate, parseDate } from './dates.mjs'

function attr(attrs, name) {
  const m = String(attrs).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : ''
}

function resolve(href, base) {
  if (!href) return ''
  try { return new URL(String(href).trim(), base || undefined).toString() } catch { return '' }
}

function slice(doc, cfg) {
  let d = doc
  if (cfg.section) { const m = d.match(new RegExp(cfg.section, 'i')); if (m) d = d.slice(m.index) }
  if (cfg.section_end) { const m = d.match(new RegExp(cfg.section_end, 'i')); if (m) d = d.slice(0, m.index) }
  return d
}

export function parseHtml(html, cfg = {}, baseUrl = '') {
  const doc = slice(String(html == null ? '' : html), cfg)
  const base = cfg.base || baseUrl
  const items = []

  if (cfg.item) {
    const flags = 'g' + String(cfg.flags || 'is').replace(/g/g, '')
    const re = new RegExp(cfg.item, flags)
    for (const m of doc.matchAll(re)) {
      const g = m.groups || {}
      const url = resolve(g.url, base)
      if (!url) continue
      const title = clean(decodeEntities(g.title || ''))
      if (!title) continue
      const date = parseDate(clean(decodeEntities(g.date || ''))) || findDate(clean(decodeEntities(m[0])))
      items.push({
        title, url, date,
        summary: truncate(clean(decodeEntities(g.summary || '')), 600),
        file: g.file ? resolve(g.file, base) : (/\.pdf(\?|#|$)/i.test(url) ? url : ''),
      })
    }
  } else {
    const linkRe = cfg.link ? new RegExp(cfg.link, 'i') : null
    const exclRe = cfg.exclude ? new RegExp(cfg.exclude, 'i') : null
    const win = cfg.date_window || 400
    const side = cfg.date_side || 'both'
    const titleMin = cfg.title_min == null ? 8 : cfg.title_min
    for (const m of doc.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(m[1], 'href')
      if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue
      const url = resolve(href, base)
      if (!url) continue
      if (linkRe && !linkRe.test(url) && !linkRe.test(href)) continue
      if (exclRe && (exclRe.test(url) || exclRe.test(href))) continue
      let title = clean(decodeEntities(m[2]))
      if (!title || title.length < titleMin) title = clean(attr(m[1], 'title') || attr(m[1], 'aria-label')) || title
      if (!title || title.length < titleMin) continue
      const end = m.index + m[0].length
      // The date is whichever well-formed date sits closest to the link, on either side (listings put it
      // before or after the title, and the wrong side would pick up the neighbouring row's date).
      let date = findDate(clean(decodeEntities(m[0])))
      if (!date) {
        const afterText = side !== 'before' ? clean(decodeEntities(doc.slice(end, end + win))) : ''
        const beforeText = side !== 'after' ? clean(decodeEntities(doc.slice(Math.max(0, m.index - win), m.index))) : ''
        const a = afterText ? allDates(afterText)[0] : null
        const bl = beforeText ? allDates(beforeText) : []
        const b = bl.length ? bl[bl.length - 1] : null
        const da = a ? a.index : Infinity
        const db = b ? beforeText.length - b.end : Infinity
        date = da <= db ? (a ? a.iso : null) : b.iso
      }
      items.push({ title, url, date, summary: '', file: /\.pdf(\?|#|$)/i.test(url) ? url : '' })
    }
  }

  // De-duplicate within the page: same URL → keep the longest title (image links often carry an empty one).
  const by = new Map()
  for (const it of items) {
    const k = normalizeUrl(it.url)
    const prev = by.get(k)
    if (!prev || it.title.length > prev.title.length) by.set(k, { ...it, date: it.date || (prev && prev.date) || null })
  }
  return [...by.values()]
}
