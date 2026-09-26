// Text helpers: entity decoding, tag stripping, Arabic normalisation, URL and title keys.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sbquo: '‚', bdquo: '„',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â',
  ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', uuml: 'ü',
  copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£', middot: '·', bull: '•', times: '×',
}

function safeChar(cp) {
  try { return String.fromCodePoint(cp) } catch { return '' }
}

export function decodeEntities(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m))
}

export function stripTags(s) {
  return decodeEntities(
    String(s == null ? '' : s)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|tr|td|th)>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

export function collapse(s) {
  return String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim()
}

/** Feed text is often double-encoded (HTML inside XML): decode, strip, decode again, collapse. */
export function clean(s) {
  return collapse(stripTags(decodeEntities(s)))
}

export function truncate(s, n = 600) {
  const t = collapse(s)
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  const sp = cut.lastIndexOf(' ')
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…'
}

/** Arabic normalisation: drop tashkeel/tatweel, unify alef, yaa, taa marbuta, hamza carriers. */
export function normalizeArabic(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ْـٰؐ-ؚۖ-ۭ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ی/g, 'ي')
}

/** Arabic-Indic and Persian digits → ASCII digits. */
export function arabicDigits(s) {
  return String(s == null ? '' : s)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
}

/** Strip Latin diacritics (é → e) without touching Arabic. */
export function stripLatinDiacritics(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
}

/** Lower-cased, digit- and Arabic-normalised, diacritic-free text for matching. */
export function normText(s) {
  return stripLatinDiacritics(normalizeArabic(arabicDigits(clean(s)))).toLowerCase()
}

/** A key for near-duplicate titles: normalised text with punctuation collapsed. */
export function titleKey(s) {
  return normText(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Canonical URL for de-duplication: https, no www, no hash, no tracking params, no trailing slash. */
export function normalizeUrl(u) {
  const raw = String(u == null ? '' : u).trim()
  if (!raw) return ''
  try {
    const x = new URL(raw)
    x.hash = ''
    x.hostname = x.hostname.toLowerCase().replace(/^www\./, '')
    for (const k of [...x.searchParams.keys()]) {
      if (/^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|yclid|_ga|igshid)$/i.test(k)) x.searchParams.delete(k)
    }
    if (x.protocol === 'http:') x.protocol = 'https:'
    let s = x.toString()
    if (!x.search) s = s.replace(/\/+$/, '')
    return s
  } catch {
    return raw
  }
}

export function sha1short(s) {
  // Lazy import keeps this module usable in the browser-side dashboard if ever needed.
  return import('node:crypto').then(c => c.createHash('sha1').update(String(s)).digest('hex').slice(0, 12))
}
