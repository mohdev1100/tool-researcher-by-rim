// Date parsing for feeds, APIs and listing pages in Arabic, French and English.
// Everything normalises to 'YYYY-MM-DD' (calendar date, no time-zone shifting).

import { arabicDigits, normalizeArabic, stripLatinDiacritics } from './text.mjs'

const MONTH_LISTS = [
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
  ['sept'],
  ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
  ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'اكتوبر', 'نونبر', 'دجنبر'],
  ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
]

function monthKey(name) {
  return stripLatinDiacritics(normalizeArabic(String(name).toLowerCase())).replace(/\.$/, '').trim()
}

const MONTHS = new Map()
for (const list of MONTH_LISTS) {
  list.forEach((name, i) => {
    if (list.length === 1) { MONTHS.set(monthKey(name), 9); return } // "sept"
    const k = monthKey(name)
    if (!MONTHS.has(k)) MONTHS.set(k, i + 1)
  })
}

function monthFromName(name) {
  return MONTHS.get(monthKey(name)) || 0
}

function valid(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d)
  if (!(y >= 1990 && y <= 2100)) return null
  if (!(m >= 1 && m <= 12)) return null
  if (!(d >= 1 && d <= 31)) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const NB = '(?<![\\p{L}\\p{N}])' // not preceded by a letter/digit (Unicode-aware word start)
const NA = '(?![\\p{L}\\p{N}])'  // not followed by a letter/digit
const WORD = '([\\p{L}]{2,}\\.?(?:\\s[\\p{L}]{2,})?)' // one or two words (كانون الثاني)

// Each pattern yields a candidate through `to`.
const PATTERNS = [
  { re: new RegExp(`${NB}(\\d{4})-(\\d{1,2})-(\\d{1,2})${NA}`, 'gu'), to: m => valid(m[1], m[2], m[3]) },
  { re: new RegExp(`${NB}(\\d{4})/(\\d{1,2})/(\\d{1,2})${NA}`, 'gu'), to: m => valid(m[1], m[2], m[3]) },
  { re: new RegExp(`${NB}(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})${NA}`, 'gu'), to: m => valid(m[3], m[2], m[1]) },
  // "25 September 2026", "25-Sep-2026", "1er août 2026", "٢٥ سبتمبر ٢٠٢٦"
  { re: new RegExp(`${NB}(\\d{1,2})(?:er|st|nd|rd|th)?[\\s-]+${WORD}[\\s-]*[,،]?[\\s-]*(\\d{4})${NA}`, 'gu'), to: m => { const mo = monthFromName(m[2]); return mo ? valid(m[3], mo, m[1]) : null } },
  // "September 25, 2026", "Sept. 25 2026"
  { re: new RegExp(`${NB}${WORD}[\\s-]+(\\d{1,2})(?:st|nd|rd|th)?\\s*[,،]?[\\s-]+(\\d{4})${NA}`, 'gu'), to: m => { const mo = monthFromName(m[1]); return mo ? valid(m[3], mo, m[2]) : null } },
  // compact timestamps such as GDELT's "20260925T143000Z"
  { re: new RegExp(`${NB}(\\d{4})(\\d{2})(\\d{2})T\\d{4,6}Z?${NA}`, 'gu'), to: m => valid(m[1], m[2], m[3]) },
  { re: new RegExp(`${NB}(\\d{4})-(\\d{1,2})${NA}`, 'gu'), to: m => valid(m[1], m[2], 1) },
  { re: new RegExp(`${NB}${WORD}\\s+(\\d{4})${NA}`, 'gu'), to: m => { const mo = monthFromName(m[1]); return mo ? valid(m[2], mo, 1) : null } },
]

/** Every well-formed date inside free text, in order of position: [{ iso, index, end }]. */
export function allDates(text) {
  if (!text) return []
  const s = arabicDigits(String(text))
  const found = []
  for (const p of PATTERNS) {
    p.re.lastIndex = 0
    for (const m of s.matchAll(p.re)) {
      const iso = p.to(m)
      if (iso) found.push({ iso, index: m.index, end: m.index + m[0].length })
    }
  }
  found.sort((a, b) => a.index - b.index || b.end - a.end)
  const out = []
  for (const c of found) {
    const last = out[out.length - 1]
    if (last && c.index < last.end) continue // "2026-09" nested inside "2026-09-25"
    out.push(c)
  }
  return out
}

/** Find the earliest well-formed date inside free text. Returns 'YYYY-MM-DD' or null. */
export function findDate(text) {
  const d = allDates(text)
  return d.length ? d[0].iso : null
}

/** Parse a single date value of any shape an API or feed hands us. */
export function parseDate(v) {
  if (v == null || v === '') return null
  if (Array.isArray(v)) {
    if (v.length && Array.isArray(v[0])) return parseDate(v[0])
    if (v.every(x => typeof x === 'number' || /^\d+$/.test(String(x)))) {
      const [y, m = 1, d = 1] = v.map(Number)
      return valid(y, m, d)
    }
    return parseDate(v[0])
  }
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v * 1000
    const dt = new Date(ms)
    return isNaN(dt) ? null : valid(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  if (typeof v === 'object') {
    // {date-parts: [[y,m,d]]} (Crossref), {created: ...} (ReliefWeb), {value: ...}
    if (v['date-parts']) return parseDate(v['date-parts'])
    for (const k of ['original', 'created', 'changed', 'value', 'date', 'published', 'start', 'end']) {
      if (v[k] != null) { const r = parseDate(v[k]); if (r) return r }
    }
    return null
  }
  const s = arabicDigits(String(v)).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return valid(iso[1], iso[2], iso[3])
  const found = findDate(s)
  if (found) return found
  const t = Date.parse(s)
  if (!isNaN(t)) {
    const dt = new Date(t)
    return valid(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  return null
}

export function todayISO(now = new Date()) {
  return valid(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())
}

export function daysBetween(a, b) {
  const da = Date.parse(a + 'T00:00:00Z'), db = Date.parse(b + 'T00:00:00Z')
  if (isNaN(da) || isNaN(db)) return null
  return Math.round((db - da) / 86400000)
}
