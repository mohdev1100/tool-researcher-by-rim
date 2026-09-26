// JSON store for collected reports plus per-source state.
// De-duplication: by canonical URL first, then by near-identical title (an aggregator such as ReliefWeb
// and the publisher's own site list the same report under different URLs → recorded as a "mirror").

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { normalizeUrl, titleKey } from './text.mjs'
import { daysBetween } from './dates.mjs'

export function itemId(url) {
  return createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12)
}

export async function loadJson(path, fallback) {
  if (!existsSync(path)) return structuredClone(fallback)
  const text = await readFile(path, 'utf8')
  try { return JSON.parse(text) } catch (e) { throw new Error(`cannot parse ${path}: ${e.message}`) }
}

export async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  await writeFile(tmp, JSON.stringify(data, null, 1) + '\n', 'utf8')
  await rename(tmp, path)
}

const TITLE_MIN = 25 // shorter titles ("Mauritania", "Country report") are too generic to de-duplicate on

export class Store {
  constructor(data) {
    this.data = data
    this.byKey = new Map()
    this.byTitle = new Map()
    for (const it of data.items) this._index(it)
  }

  static async open(path) {
    const data = await loadJson(path, { version: 1, updated: null, items: [] })
    if (!Array.isArray(data.items)) data.items = []
    return new Store(data)
  }

  _index(it) {
    this.byKey.set(it.key, it)
    if (it.title_key && it.title_key.length >= TITLE_MIN) {
      if (!this.byTitle.has(it.title_key)) this.byTitle.set(it.title_key, [])
      this.byTitle.get(it.title_key).push(it)
    }
  }

  get items() { return this.data.items }

  /**
   * Insert or refresh a candidate. Returns { status: 'new' | 'seen' | 'mirror', item }.
   * `today` is the run date ('YYYY-MM-DD').
   */
  upsert(c, today) {
    // key_suffix ('#2026-11-01') lets a single page that is re-issued under the same URL count as a new edition.
    const key = normalizeUrl(c.url) + (c.key_suffix || '')
    const existing = this.byKey.get(key)
    if (existing) {
      existing.last_seen = today
      if (!existing.date && c.date) existing.date = c.date
      if (!existing.summary && c.summary) existing.summary = c.summary
      if (!existing.file && c.file) existing.file = c.file
      if (!existing.type && c.type) existing.type = c.type
      if ((!existing.topics || !existing.topics.length) && c.topics && c.topics.length) existing.topics = c.topics
      if (existing.relevance !== 'direct' && c.relevance === 'direct') existing.relevance = 'direct'
      return { status: 'seen', item: existing }
    }
    const tk = titleKey(c.title)
    if (tk.length >= TITLE_MIN && !c.key_suffix) {
      const twins = this.byTitle.get(tk) || []
      for (const t of twins) {
        const gap = t.date && c.date ? Math.abs(daysBetween(t.date, c.date) ?? 999) : 0
        if (gap <= 60) {
          t.mirrors = t.mirrors || []
          if (!t.mirrors.some(m => normalizeUrl(m.url) === key)) t.mirrors.push({ url: c.url, source: c.source, seen: today })
          if (!t.file && c.file) t.file = c.file
          if (!t.date && c.date) t.date = c.date
          if (!t.summary && c.summary) t.summary = c.summary
          t.last_seen = today
          this.byKey.set(key, t) // later runs resolve the mirror URL straight to the item
          return { status: 'mirror', item: t }
        }
      }
    }
    const item = {
      id: createHash('sha1').update(key).digest('hex').slice(0, 12), // = itemId(url) when there is no suffix
      key,
      title: c.title,
      url: c.url,
      file: c.file || '',
      date: c.date || null,
      summary: c.summary || '',
      lang: c.lang || '',
      type: c.type || '',
      tags: c.tags || [],
      author: c.author || '',
      publisher: c.publisher || '',
      publisher_ar: c.publisher_ar || '',
      source: c.source,
      source_name: c.source_name || '',
      tier: c.tier || '',
      category: c.category || '',
      scope: c.scope || '',
      relevance: c.relevance,
      report_like: !!c.report_like,
      topics: c.topics || [],
      title_key: tk,
      first_seen: today,
      last_seen: today,
      mirrors: [],
    }
    this.data.items.push(item)
    this._index(item)
    return { status: 'new', item }
  }

  /**
   * Newest first: by document date, undated items by the day we first saw them. A date in the future
   * (publishers' print dates, e.g. a book chapter dated 31 December) orders as the day we saw it, so
   * forthcoming items do not sit above today's.
   */
  sorted() {
    const eff = it => (it.date && it.first_seen && it.date > it.first_seen) ? it.first_seen : (it.date || it.first_seen || '')
    return [...this.data.items].sort((a, b) => (eff(b) > eff(a) ? 1 : eff(b) < eff(a) ? -1 : (b.first_seen > a.first_seen ? 1 : -1)))
  }

  async save(path, updatedAt) {
    this.data.items = this.sorted()
    this.data.updated = updatedAt
    this.data.count = this.data.items.length
    await saveJson(path, this.data)
  }
}

export async function openState(path) {
  const st = await loadJson(path, { version: 1, sources: {}, runs: [] })
  if (!st.sources) st.sources = {}
  if (!Array.isArray(st.runs)) st.runs = []
  return st
}
