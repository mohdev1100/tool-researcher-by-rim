// Output renderers: the Arabic digest (Markdown), the dashboard (one self-contained HTML file),
// an RSS feed and a JSON Feed of everything about Mauritania, and the source-health sheet.

import { truncate } from './text.mjs'
import { daysBetween } from './dates.mjs'

export const LABELS = {
  relevance: { direct: 'عن موريتانيا مباشرة', regional: 'إقليمي (يشمل موريتانيا)' },
  tier: { A: 'مؤسسة أولية', B: 'مركز بحثي / أكاديمي', C: 'إعلام ومجمّعات' },
  category: {
    'un-humanitarian': 'الأمم المتحدة والعمل الإنساني',
    'economy-ifi': 'الاقتصاد والمؤسسات المالية',
    'rights-governance': 'حقوق الإنسان والحوكمة',
    'security-thinktanks': 'الأمن ومراكز الفكر',
    'food-climate-health': 'الغذاء والمناخ والصحة',
    'mauritania-arabic-regional': 'مصادر موريتانية وعربية وإقليمية',
    'migration-education-development': 'الهجرة والتعليم والتنمية',
    'academic-aggregators': 'بحث أكاديمي ومجمّعات',
    data: 'بيانات مفتوحة',
    other: 'أخرى',
  },
  topic: {
    economy: 'اقتصاد', 'public-finance': 'مالية عامة', governance: 'حوكمة وشفافية', rights: 'حقوق الإنسان',
    development: 'تنمية', mining: 'تعدين وطاقة', health: 'صحة', education: 'تعليم', migration: 'هجرة',
    justice: 'عدالة', social: 'مجتمع', environment: 'بيئة',
  },
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const mdEsc = s => String(s == null ? '' : s).replace(/[\[\]]/g, m => '\\' + m).replace(/\*/g, '\\*')

function within(it, days, today) {
  const d = it.date || it.first_seen
  const n = daysBetween(d, today)
  return n != null && n >= 0 && n <= days
}

function line(it) {
  const pub = it.publisher_ar ? `${it.publisher_ar} (${it.publisher})` : it.publisher
  const bits = [pub, it.date || `رُصد ${it.first_seen}`, it.type, it.file ? `[PDF](${it.file})` : '', `\`${it.source}\``].filter(Boolean)
  return `- **[${mdEsc(it.title)}](${it.url})** — ${bits.join(' · ')}`
}

export function renderDigest({ items, newIds, state, today, since, digestDays, errors }) {
  const isNew = it => newIds.has(it.id)
  const direct = items.filter(it => it.relevance === 'direct')
  const regional = items.filter(it => it.relevance === 'regional')
  const newDirect = direct.filter(isNew)
  const newRegional = regional.filter(isNew)
  const recent = direct.filter(it => !isNew(it) && within(it, digestDays, today))
  const srcs = Object.entries(state.sources || {})
  const ok = srcs.filter(([, s]) => s.status === 'ok' || s.status === 'not-modified').length
  const out = []
  out.push('# Tool Researcher by RIM — رادار التقارير')
  out.push('')
  out.push(`_تشغيل ${today} · المصادر: ${srcs.length} (${ok} تعمل، ${srcs.length - ok} متعثرة) · النافذة: منذ ${since} · الرصيد الكلي: ${items.length} عنصرًا (${direct.length} مباشر)_`)
  out.push('')
  out.push(`## جديد في هذا التشغيل — عن موريتانيا مباشرة (${newDirect.length})`)
  out.push('')
  out.push(...(newDirect.length ? newDirect.map(line) : ['_لا جديد._']))
  out.push('')
  out.push(`## جديد في هذا التشغيل — إقليمي يشمل موريتانيا (${newRegional.length})`)
  out.push('')
  out.push(...(newRegional.length ? newRegional.map(line) : ['_لا جديد._']))
  out.push('')
  out.push(`## آخر ${digestDays} يومًا — ما سبق رصده (${recent.length})`)
  out.push('')
  out.push(...(recent.length ? recent.map(line) : ['_لا شيء._']))
  out.push('')
  if (errors && errors.length) {
    out.push(`## مصادر متعثرة (${errors.length})`)
    out.push('')
    for (const e of errors) out.push(`- \`${e.id}\` — ${e.error}`)
    out.push('')
  }
  out.push('---')
  out.push('_يُولَّد هذا الملف آليًا بأداة رادار التقارير (`radar/`). لوحة التصفح: `radar/out/index.html`. الخلاصة القابلة للاشتراك: `radar/out/feed.xml`._')
  out.push('')
  return out.join('\n')
}

function rfc822(iso) {
  const d = new Date((iso || '1970-01-01') + 'T08:00:00Z')
  return isNaN(d) ? new Date(0).toUTCString() : d.toUTCString()
}

export function renderRss({ items, today, title = 'Tool Researcher by RIM — رادار التقارير', link = '' , max = 200 }) {
  const list = items.filter(it => it.relevance === 'direct').slice(0, max)
  const x = []
  x.push('<?xml version="1.0" encoding="UTF-8"?>')
  x.push('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">')
  x.push('<channel>')
  x.push(`<title>${esc(title)}</title>`)
  x.push(`<link>${esc(link)}</link>`)
  x.push('<description>أحدث التقارير الموثوقة عن موريتانيا، تُجمع آليًا من مصادر مؤسسية وبحثية</description>')
  x.push('<language>ar</language>')
  x.push(`<lastBuildDate>${rfc822(today)}</lastBuildDate>`)
  for (const it of list) {
    const desc = [it.publisher_ar || it.publisher, it.type, it.summary].filter(Boolean).join(' — ')
    x.push('<item>')
    x.push(`<title>${esc(it.title)}</title>`)
    x.push(`<link>${esc(it.url)}</link>`)
    x.push(`<guid isPermaLink="false">${esc(it.id)}</guid>`)
    x.push(`<pubDate>${rfc822(it.date || it.first_seen)}</pubDate>`)
    x.push(`<dc:creator>${esc(it.publisher)}</dc:creator>`)
    x.push(`<description>${esc(desc)}</description>`)
    for (const t of it.topics || []) x.push(`<category>${esc(LABELS.topic[t] || t)}</category>`)
    if (it.file && /\.pdf(\?|#|$)/i.test(it.file)) x.push(`<enclosure url="${esc(it.file)}" type="application/pdf" length="0"/>`)
    x.push('</item>')
  }
  x.push('</channel>')
  x.push('</rss>')
  return x.join('\n') + '\n'
}

export function renderJsonFeed({ items, today, max = 500 }) {
  const list = items.filter(it => it.relevance === 'direct').slice(0, max)
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Tool Researcher by RIM — رادار التقارير',
    
    description: 'أحدث التقارير الموثوقة عن موريتانيا',
    language: 'ar',
    items: list.map(it => ({
      id: it.id,
      url: it.url,
      title: it.title,
      content_text: [it.publisher_ar || it.publisher, it.type, it.summary].filter(Boolean).join(' — '),
      date_published: (it.date || it.first_seen) + 'T08:00:00Z',
      authors: [{ name: it.publisher }],
      tags: (it.topics || []).map(t => LABELS.topic[t] || t),
      attachments: it.file ? [{ url: it.file, mime_type: /\.pdf(\?|#|$)/i.test(it.file) ? 'application/pdf' : 'application/octet-stream' }] : undefined,
      _radar: { source: it.source, tier: it.tier, category: it.category, relevance: it.relevance, first_seen: it.first_seen, language: it.lang },
    })),
  }, null, 1) + '\n'
}

/**
 * A compact, paste-ready brief for an AI assistant: preamble, counts, then the items grouped by topic
 * with title, publisher, date, link and a one-line summary. Meant for "what do we have, what is new,
 * what deserves a review" conversations in Claude or any other assistant.
 */
export function renderBrief({ items, today, days = 7, relevance = 'direct', max = 150, filterLabel = '' }) {
  const inWindow = it => { const n = daysBetween(it.first_seen, today); return n != null && n >= 0 && n <= days }
  let list = items.filter(it => (relevance === 'all' || it.relevance === relevance) && inWindow(it))
  // Dated documents first (newest first), then the undated ones the listings gave no date for.
  list.sort((a, b) => (a.date && b.date) ? (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) : a.date ? -1 : b.date ? 1 : 0)
  const total = list.length
  list = list.slice(0, max)
  const byTopic = new Map()
  for (const it of list) {
    const t = (it.topics && it.topics[0]) || 'other'
    if (!byTopic.has(t)) byTopic.set(t, [])
    byTopic.get(t).push(it)
  }
  const out = []
  out.push('أنت مساعد بحثي لفريق تحرير يتابع التقارير الصادرة عن موريتانيا ويراجعها ويلخّصها للقارئ العربي.')
  out.push('أدناه ما رصدته أداتنا (Tool Researcher by RIM) آليًا من مصادر مؤسسية وبحثية موثوقة. كل عنصر: العنوان كما نشره الناشر، الناشر، تاريخ الوثيقة (أو يوم الرصد إن لم يُذكر)، الرابط، ملخص قصير إن وُجد.')
  out.push('المطلوب منك: (1) لخّص المشهد في فقرة؛ (2) جمّع العناصر في محاور موضوعية واذكر أهم 5–10 تقارير تستحق مراجعة كاملة مع سبب الاختيار؛ (3) أشر إلى ما يبدو مكرّرًا أو ثانويًا؛ (4) اقترح ما ينقص الرصد (جهات أو موضوعات غائبة). لا تختلق تقارير غير مذكورة هنا؛ إن احتجت معلومة غير موجودة فقل ذلك.')
  out.push('')
  out.push(`# موجز الرادار — ${today}`)
  out.push(`النافذة: ما رُصد خلال آخر ${days} يومًا${relevance === 'direct' ? ' (عن موريتانيا مباشرة)' : relevance === 'regional' ? ' (إقليمي يشمل موريتانيا)' : ''}${filterLabel ? ' · ' + filterLabel : ''}. العدد: ${total}${total > max ? ` (مُدرج ${max})` : ''}.`)
  out.push('')
  for (const [topic, arr] of [...byTopic.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`## ${LABELS.topic[topic] || (topic === 'other' ? 'متفرقات' : topic)} (${arr.length})`)
    for (const it of arr) {
      const pub = it.publisher_ar ? `${it.publisher_ar} / ${it.publisher}` : it.publisher
      out.push(`- ${it.title} — ${pub} — ${it.date || 'رُصد ' + it.first_seen}${it.type ? ' — ' + it.type : ''}`)
      out.push(`  ${it.url}${it.file && it.file !== it.url ? ' · PDF: ' + it.file : ''}`)
      if (it.summary) out.push(`  ${truncate(it.summary, 220)}`)
    }
    out.push('')
  }
  return out.join('\n')
}

export function renderHealth({ results, today }) {
  const out = ['# صحة المصادر — رادار التقارير', '', `_فحص ${today}_`, '']
  out.push('| المصدر | الحالة | HTTP | عناصر | مقبول | أحدث تاريخ | ملاحظة |')
  out.push('|---|---|---|---|---|---|---|')
  for (const r of results) {
    const s = r.source
    const via = r.via === 'browser' ? 'عبر المتصفح' : r.via === 'curl' ? 'عبر curl' : ''
    out.push(`| \`${s.id}\` ${s.name ? '— ' + s.name : ''} | ${r.status} | ${r.http || ''} | ${r.raw == null ? '' : r.raw} | ${r.kept ? r.kept.length : 0} | ${r.newest || ''} | ${esc(r.error || via)} |`)
  }
  out.push('')
  return out.join('\n')
}

function slim(it) {
  return {
    id: it.id, title: it.title, url: it.url, file: it.file || '', date: it.date, first_seen: it.first_seen,
    publisher: it.publisher, publisher_ar: it.publisher_ar || '', source: it.source, tier: it.tier, category: it.category,
    relevance: it.relevance, topics: it.topics || [], type: it.type || '', lang: it.lang || '',
    summary: truncate(it.summary || '', 240), mirrors: (it.mirrors || []).length,
  }
}

export function renderDashboard({ items, state, today, since, sources }) {
  const payload = {
    generated: today,
    since,
    labels: LABELS,
    items: items.map(slim),
    sources: sources.map(s => ({ id: s.id, name: s.name, name_ar: s.name_ar || '', tier: s.tier, category: s.category, publisher: s.publisher })),
    health: Object.entries(state.sources || {}).map(([id, s]) => ({ id, status: s.status, error: s.error || '', kept: s.kept || 0, last_run: s.last_run || '' })),
  }
  const json = JSON.stringify(payload).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><meta name="referrer" content="no-referrer">
<title>Tool Researcher by RIM</title>
<meta name="description" content="Tool Researcher by RIM — رادار التقارير: لوحة تصفح أحدث التقارير الموثوقة عن موريتانيا، تُجمع آليًا من مصادر مؤسسية وبحثية">
<style>
:root{--bg:#f7f4ee;--fg:#1d1b18;--muted:#6b665d;--card:#fffdf9;--line:#e4ded3;--accent:#1f5f8b;--accent-fg:#fff;--new:#b4531d;--chip:#efe9dd;--shadow:0 1px 2px rgba(0,0,0,.05);--s1:#2a78d6;--s2:#eb6834;--grid:#e1e0d9;--axis:#c3c2b7;--ink2:#52514e;--ink3:#898781}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151412;--fg:#ebe8e2;--muted:#a49e93;--card:#1f1d1a;--line:#302d28;--accent:#8ec0ea;--accent-fg:#0f1b26;--new:#f0a069;--chip:#2a2723;--shadow:none;--s1:#3987e5;--s2:#d95926;--grid:#2c2c2a;--axis:#383835;--ink2:#c3c2b7;--ink3:#898781}}
:root[data-theme="dark"]{--bg:#151412;--fg:#ebe8e2;--muted:#a49e93;--card:#1f1d1a;--line:#302d28;--accent:#8ec0ea;--accent-fg:#0f1b26;--new:#f0a069;--chip:#2a2723;--shadow:none;--s1:#3987e5;--s2:#d95926;--grid:#2c2c2a;--axis:#383835;--ink2:#c3c2b7;--ink3:#898781}
.trends{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin:12px 0}
.viz{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow);min-width:0}
.viz h2{font-size:.95rem;margin:0 0 2px;font-weight:600}
.viz .sub{font-size:.8rem;color:var(--muted);margin:0 0 8px}
.viz .legend{display:flex;gap:14px;font-size:.78rem;color:var(--ink2);margin:0 0 6px}
.viz .legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-inline-end:5px;vertical-align:-1px}
.viz .legend .k1 i{background:var(--s1)}.viz .legend .k2 i{background:var(--s2)}
.chart{position:relative;direction:ltr}
.chart svg{display:block;width:100%;height:auto;overflow:visible}
.chart .bar{cursor:pointer}
.chart .grid{stroke:var(--grid);stroke-width:1}
.chart .base{stroke:var(--axis);stroke-width:1}
.chart text{font:11px system-ui,"Segoe UI",sans-serif;fill:var(--ink3)}
.chart .lbl{fill:var(--ink2);font-weight:600}
.tip{position:absolute;pointer-events:none;background:var(--fg);color:var(--bg);font-size:.78rem;padding:6px 9px;border-radius:8px;white-space:nowrap;transform:translate(-50%,-110%);direction:rtl;display:none;z-index:2}
.hbars{display:grid;gap:6px;font-size:.82rem}
.hrow{display:grid;grid-template-columns:minmax(0,1.6fr) 2fr auto;align-items:center;gap:8px}
.hrow .n{color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hrow .t{height:12px;background:transparent;position:relative}
.hrow .t i{display:block;height:12px;background:var(--s1);border-radius:4px 0 0 4px;min-width:2px}
.hrow .v{color:var(--ink2);font-variant-numeric:tabular-nums;min-width:2ch;text-align:left}
.viz details{margin-top:6px;font-size:.8rem}.viz details summary{cursor:pointer;color:var(--muted)}
.viz table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:4px}.viz td,.viz th{border-bottom:1px solid var(--line);padding:2px 6px;text-align:start;font-variant-numeric:tabular-nums}
.stat .delta{display:block;font-size:.78rem;color:var(--ink2);margin-top:2px}
.briefbox{width:100%;min-height:220px;font:12px/1.5 ui-monospace,Consolas,monospace;direction:rtl;margin-top:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);padding:8px;box-sizing:border-box}
@media (max-width:900px){.trends{grid-template-columns:1fr 1fr}.trends .viz:first-child{grid-column:1/-1}}
@media (max-width:600px){.trends{grid-template-columns:1fr}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 "Noto Naskh Arabic","Segoe UI","Helvetica Neue",Arial,sans-serif}
a{color:var(--accent)}
.wrap{max-width:1100px;margin:0 auto;padding:16px}
header h1{font-size:1.5rem;margin:0 0 4px}
header p{margin:0;color:var(--muted);font-size:.95rem}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-width:120px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:1.3rem;line-height:1.2}
.stat span{color:var(--muted);font-size:.85rem}
.filters{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(160px,100%),1fr));gap:8px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:12px 0;min-width:0}
.filters label{display:flex;flex-direction:column;font-size:.8rem;color:var(--muted);gap:2px;min-width:0}
.filters input,.filters select{font:inherit;font-size:.95rem;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);min-width:0;width:100%;max-width:100%;box-sizing:border-box}
.filters .check{flex-direction:row;align-items:center;gap:6px;align-self:end;padding-bottom:8px}
.filters .q{grid-column:1/-1}
.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 12px}
.toolbar button{font:inherit;font-size:.9rem;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);cursor:pointer}
.toolbar button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.count{color:var(--muted);margin-inline-start:auto;font-size:.9rem}
.list{display:grid;gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;box-shadow:var(--shadow)}
.card.new{border-inline-start:4px solid var(--new)}
.card .meta{font-size:.82rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 10px}
.card{min-width:0;overflow-wrap:anywhere}
.card h3{margin:4px 0 6px;font-size:1.05rem;line-height:1.5;font-weight:600}
.card h3 a{text-decoration:none}
.card h3 a:hover{text-decoration:underline}
.card .sum{margin:0 0 8px;font-size:.92rem;color:var(--fg);opacity:.85}
.tags{display:flex;flex-wrap:wrap;gap:6px;font-size:.78rem}
.tag{background:var(--chip);border-radius:999px;padding:2px 10px}
.tag.rel-direct{background:var(--accent);color:var(--accent-fg)}
.tag.rel-regional{border:1px solid var(--accent);color:var(--accent)}
.tag.badge-new{background:var(--new);color:#fff}
.tag a{color:inherit}
.more{display:block;width:100%;margin:12px 0;font:inherit;padding:10px;border:1px dashed var(--line);border-radius:10px;background:transparent;color:var(--fg);cursor:pointer}
.health{margin:24px 0 8px}
.health summary{cursor:pointer;color:var(--muted)}
.health table{width:100%;border-collapse:collapse;font-size:.85rem}
.health td,.health th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:start}
.health .err{color:var(--new)}
footer{color:var(--muted);font-size:.82rem;margin:24px 0}
[dir="ltr"]{text-align:left}
.health{min-width:0;overflow-x:auto}
@media (max-width:600px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters .q{grid-column:1/-1}.stat{flex:1 1 40%;min-width:0}.wrap{padding:12px 16px}}
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>Tool Researcher by RIM — رادار التقارير</h1>
<p>آخر تحديث <time id="gen"></time> · النافذة منذ <span id="since"></span> · يُجمع آليًا من مصادر موثوقة ويُصفَّى على موريتانيا</p>
</header>
<div class="stats" id="stats"></div>
<section class="trends" aria-label="الاتجاهات">
<div class="viz">
<h2>ما رُصد يوميًا — آخر 30 يومًا</h2>
<p class="sub" id="dailySub"></p>
<div class="legend"><span class="k1"><i></i>عن موريتانيا مباشرة</span><span class="k2"><i></i>إقليمي</span></div>
<div class="chart" id="daily"></div>
<details><summary>جدول القيم</summary><table id="dailyTable"></table></details>
</div>
<div class="viz"><h2>أكثر الناشرين — آخر 30 يومًا</h2><p class="sub">عدد العناصر المرصودة لكل ناشر</p><div class="hbars" id="pubBars"></div></div>
<div class="viz"><h2>الموضوعات — آخر 30 يومًا</h2><p class="sub">عنصر واحد قد يحمل أكثر من موضوع</p><div class="hbars" id="topicBars"></div></div>
</section>
<form class="filters" id="filters" onsubmit="return false">
<label class="q">بحث في العنوان والملخص والناشر<input id="q" type="search" placeholder="مثال: صندوق النقد، الهجرة، rapport"></label>
<label>الصلة<select id="rel"><option value="">الكل</option><option value="direct">عن موريتانيا مباشرة</option><option value="regional">إقليمي يشمل موريتانيا</option></select></label>
<label>الفئة<select id="cat"><option value="">الكل</option></select></label>
<label>الناشر<select id="pub"><option value="">الكل</option></select></label>
<label>الموضوع<select id="topic"><option value="">الكل</option></select></label>
<label>نوع المصدر<select id="tier"><option value="">الكل</option></select></label>
<label>اللغة<select id="lang"><option value="">الكل</option></select></label>
<label>من تاريخ<input id="since_f" type="date"></label>
<label>رُصد خلال<select id="fresh"><option value="">أي وقت</option><option value="1">اليوم</option><option value="7">7 أيام</option><option value="14">14 يومًا</option><option value="30">30 يومًا</option><option value="90">90 يومًا</option></select></label>
<label>الترتيب<select id="sort"><option value="date">تاريخ الوثيقة</option><option value="seen">تاريخ الرصد</option><option value="pub">الناشر</option></select></label>
<label class="check"><input id="pdf" type="checkbox"> بملف PDF فقط</label>
</form>
<div class="toolbar">
<button type="button" id="reset">مسح التصفية</button>
<button type="button" id="copy">نسخ القائمة (Markdown)</button>
<button type="button" id="brief">نسخ موجزًا للذكاء الاصطناعي</button>
<button type="button" id="csv" class="primary">تنزيل CSV</button>
<span class="count" id="count"></span>
</div>
<textarea class="briefbox" id="briefbox" hidden readonly aria-label="موجز الذكاء الاصطناعي"></textarea>
<div class="list" id="list"></div>
<button type="button" class="more" id="more" hidden>عرض المزيد</button>
<details class="health"><summary>حالة المصادر</summary><table id="health"></table></details>
<footer>Tool Researcher by RIM — أداة داخلية. الملف مستقل بذاته ويعمل دون اتصال.</footer>
</div>
<script id="data" type="application/json">${json}</script>
<script>
(function(){
var DATA=JSON.parse(document.getElementById('data').textContent);
var L=DATA.labels,items=DATA.items;
function $(s){return document.querySelector(s)}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[\\u064B-\\u0652\\u0640]/g,'').replace(/[\\u0623\\u0625\\u0622]/g,'\\u0627').replace(/\\u0649/g,'\\u064A').replace(/\\u0629/g,'\\u0647')}
function days(d){if(!d)return 1e9;var t=Date.parse(d+'T00:00:00Z'),n=Date.parse(DATA.generated+'T00:00:00Z');return Math.round((n-t)/864e5)}
function isLatin(s){return !/[\\u0600-\\u06FF]/.test(s||'')}
$('#gen').textContent=DATA.generated;$('#since').textContent=DATA.since;
var F={q:$('#q'),rel:$('#rel'),cat:$('#cat'),pub:$('#pub'),topic:$('#topic'),tier:$('#tier'),lang:$('#lang'),since:$('#since_f'),fresh:$('#fresh'),pdf:$('#pdf'),sort:$('#sort')};
function counts(fn){var m={};items.forEach(function(it){var v=fn(it);(Array.isArray(v)?v:[v]).forEach(function(k){if(!k)return;m[k]=(m[k]||0)+1})});return m}
function fillSelect(sel,map,labelOf,byCount){var keys=Object.keys(map);keys.sort(byCount?function(a,b){return map[b]-map[a]}:function(a,b){return String(labelOf(a)).localeCompare(String(labelOf(b)),'ar')});keys.forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=labelOf(k)+' ('+map[k]+')';sel.appendChild(o)})}
var pubName={};items.forEach(function(it){pubName[it.publisher]=it.publisher_ar?it.publisher_ar+' — '+it.publisher:it.publisher});
fillSelect(F.cat,counts(function(i){return i.category}),function(k){return L.category[k]||k});
fillSelect(F.pub,counts(function(i){return i.publisher}),function(k){return pubName[k]||k},true);
fillSelect(F.topic,counts(function(i){return i.topics}),function(k){return L.topic[k]||k});
fillSelect(F.tier,counts(function(i){return i.tier}),function(k){return L.tier[k]||k});
fillSelect(F.lang,counts(function(i){return (i.lang||'').toLowerCase().slice(0,2)}),function(k){return {ar:'العربية',fr:'الفرنسية',en:'الإنجليزية'}[k]||k});
var stats=$('#stats');function stat(n,l,d2){var d=document.createElement('div');d.className='stat';d.innerHTML='<b>'+n+'</b><span>'+esc(l)+'</span>'+(d2?'<span class="delta">'+esc(d2)+'</span>':'');stats.appendChild(d)}
var new7=items.filter(function(i){return days(i.first_seen)<=6}).length,prev7=items.filter(function(i){var d=days(i.first_seen);return d>=7&&d<=13}).length;
var deltaTxt=prev7||new7?((new7-prev7>=0?'▲ +':'▼ ')+(new7-prev7)+' مقابل الأسبوع السابق ('+prev7+')'):'';
stat(items.length,'إجمالي العناصر');stat(items.filter(function(i){return i.relevance==='direct'}).length,'عن موريتانيا مباشرة');stat(new7,'رُصد خلال 7 أيام',deltaTxt);
var hOk=DATA.health.filter(function(h){return h.status==='ok'||h.status==='not-modified'}).length;stat(hOk+' / '+DATA.health.length,'مصادر تعمل');
/* ---- trends (last 30 days by the day an item was first seen) ---- */
(function trends(){
var N=30,gen=Date.parse(DATA.generated+'T00:00:00Z'),day=[];for(var k=N-1;k>=0;k--){var d=new Date(gen-k*864e5);day.push({iso:d.toISOString().slice(0,10),direct:0,regional:0})}
var idx={};day.forEach(function(d,i){idx[d.iso]=i});var recent=[];
items.forEach(function(i){var j=idx[i.first_seen];if(j==null)return;recent.push(i);if(i.relevance==='direct')day[j].direct++;else day[j].regional++});
var tot=recent.length,dir=recent.filter(function(i){return i.relevance==='direct'}).length;
$('#dailySub').textContent=tot+' عنصرًا خلال 30 يومًا ('+dir+' مباشر) · اليوم الأعلى: '+(function(){var m=day.reduce(function(a,b){return (b.direct+b.regional)>(a.direct+a.regional)?b:a},day[0]);return m.iso+' ('+(m.direct+m.regional)+')'})();
var W=640,H=200,ml=30,mr=8,mt=10,mb=26,pw=W-ml-mr,ph=H-mt-mb,slot=pw/N,bw=Math.min(24,slot*0.72);
var max=Math.max(1,Math.max.apply(null,day.map(function(d){return d.direct+d.regional})));var step=max<=5?1:max<=10?2:max<=25?5:max<=50?10:max<=100?25:max<=250?50:100;var top=Math.ceil(max/step)*step;
function y(v){return mt+ph-ph*v/top}
var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="عدد العناصر المرصودة يوميًا خلال آخر 30 يومًا">';
for(var g=0;g<=top;g+=step){s+='<line class="grid" x1="'+ml+'" x2="'+(W-mr)+'" y1="'+y(g).toFixed(1)+'" y2="'+y(g).toFixed(1)+'"/><text x="'+(ml-6)+'" y="'+(y(g)+4).toFixed(1)+'" text-anchor="end">'+g+'</text>'}
s+='<line class="base" x1="'+ml+'" x2="'+(W-mr)+'" y1="'+y(0)+'" y2="'+y(0)+'"/>';
day.forEach(function(d,i){var x=ml+i*slot+(slot-bw)/2,t=d.direct+d.regional;
 if(d.direct){var h1=ph*d.direct/top,y1=y(d.direct);s+='<path class="bar" data-i="'+i+'" fill="var(--s1)" d="M'+x+' '+y(0)+' V'+(y1+(d.regional?0:4))+(d.regional?' H'+(x+bw):' q0 -4 4 -4 H'+(x+bw-4)+' q4 0 4 4')+' V'+y(0)+' Z"/>'}
 if(d.regional){var y2=y(t),yb=y(d.direct)-(d.direct?2:0);s+='<path class="bar" data-i="'+i+'" fill="var(--s2)" d="M'+x+' '+yb+' V'+(y2+4)+' q0 -4 4 -4 H'+(x+bw-4)+' q4 0 4 4 V'+yb+' Z"/>'}
 s+='<rect class="bar" data-i="'+i+'" x="'+(ml+i*slot)+'" y="'+mt+'" width="'+slot+'" height="'+(ph)+'" fill="transparent"/>';
 if((N-1-i)%5===0){s+='<text x="'+(x+bw/2)+'" y="'+(H-8)+'" text-anchor="middle">'+d.iso.slice(5).replace('-','/')+'</text>'}
 if(t===max&&max>0){s+='<text class="lbl" x="'+(x+bw/2)+'" y="'+(y(t)-6).toFixed(1)+'" text-anchor="middle">'+t+'</text>'}
});
s+='</svg><div class="tip" id="dailyTip"></div>';$('#daily').innerHTML=s;
var tip=$('#dailyTip'),chart=$('#daily');
chart.addEventListener('mousemove',function(e){var el=e.target.closest('.bar');if(!el){tip.style.display='none';return}var d=day[+el.getAttribute('data-i')];tip.innerHTML=d.iso+'<br>مباشر '+d.direct+' · إقليمي '+d.regional+' · المجموع '+(d.direct+d.regional);var r=chart.getBoundingClientRect();tip.style.left=(e.clientX-r.left)+'px';tip.style.top=(e.clientY-r.top-8)+'px';tip.style.display='block'});
chart.addEventListener('mouseleave',function(){tip.style.display='none'});
$('#dailyTable').innerHTML='<tr><th>اليوم</th><th>مباشر</th><th>إقليمي</th><th>المجموع</th></tr>'+day.slice().reverse().map(function(d){return '<tr><td>'+d.iso+'</td><td>'+d.direct+'</td><td>'+d.regional+'</td><td>'+(d.direct+d.regional)+'</td></tr>'}).join('');
function hbars(sel,map,labelOf,n){var keys=Object.keys(map).sort(function(a,b){return map[b]-map[a]}).slice(0,n);var mx=Math.max(1,map[keys[0]]||0);$(sel).innerHTML=keys.length?keys.map(function(k){return '<div class="hrow" title="'+esc(labelOf(k))+'"><span class="n">'+esc(labelOf(k))+'</span><span class="t"><i style="width:'+(100*map[k]/mx).toFixed(1)+'%"></i></span><span class="v">'+map[k]+'</span></div>'}).join(''):'<p class="sub">لا عناصر خلال 30 يومًا.</p>'}
var pm={},tm={};recent.forEach(function(i){var p=i.publisher_ar||i.publisher;pm[p]=(pm[p]||0)+1;i.topics.forEach(function(t){tm[t]=(tm[t]||0)+1})});
hbars('#pubBars',pm,function(k){return k},8);hbars('#topicBars',tm,function(k){return L.topic[k]||k},8);
})();
try{var saved=JSON.parse(localStorage.getItem('radar-filters')||'{}');Object.keys(F).forEach(function(k){if(saved[k]!=null){if(F[k].type==='checkbox')F[k].checked=!!saved[k];else F[k].value=saved[k]}})}catch(e){}
var shown=0,PAGE=100,current=[];
function filtered(){var q=norm(F.q.value),rel=F.rel.value,cat=F.cat.value,pub=F.pub.value,topic=F.topic.value,tier=F.tier.value,lang=F.lang.value,since=F.since.value,fresh=F.fresh.value?+F.fresh.value:0,pdf=F.pdf.checked;
var out=items.filter(function(i){
if(rel&&i.relevance!==rel)return false;if(cat&&i.category!==cat)return false;if(pub&&i.publisher!==pub)return false;if(topic&&i.topics.indexOf(topic)<0)return false;if(tier&&i.tier!==tier)return false;if(lang&&(i.lang||'').toLowerCase().slice(0,2)!==lang)return false;
if(since&&(i.date||i.first_seen)<since)return false;if(fresh&&days(i.first_seen)>fresh)return false;if(pdf&&!i.file)return false;
if(q){var hay=norm(i.title+' '+i.summary+' '+i.publisher+' '+i.publisher_ar+' '+i.type+' '+i.source+' '+i.topics.map(function(t){return L.topic[t]||t}).join(' ')+' '+(L.relevance[i.relevance]||'')+' '+(L.category[i.category]||''));if(hay.indexOf(q)<0)return false}
return true});
var s=F.sort.value;out.sort(function(a,b){if(s==='pub')return (a.publisher_ar||a.publisher).localeCompare(b.publisher_ar||b.publisher,'ar')||((b.date||b.first_seen)>(a.date||a.first_seen)?1:-1);if(s==='seen')return b.first_seen>a.first_seen?1:b.first_seen<a.first_seen?-1:((b.date||'')>(a.date||'')?1:-1);var da=a.date||a.first_seen,db=b.date||b.first_seen;return db>da?1:db<da?-1:(b.first_seen>a.first_seen?1:-1)});
return out}
function card(i){var el=document.createElement('article');el.className='card'+(days(i.first_seen)<=7?' new':'');var dir=isLatin(i.title)?' dir="ltr"':'';
var meta='<span>'+esc(i.publisher_ar||i.publisher)+(i.publisher_ar?' <span dir="ltr">('+esc(i.publisher)+')</span>':'')+'</span>'+(i.date?'<time>'+i.date+'</time>':'<span>بلا تاريخ · رُصد '+i.first_seen+'</span>')+(i.type?'<span'+(isLatin(i.type)?' dir="ltr"':'')+'>'+esc(i.type)+'</span>':'');
var tags='<span class="tag rel-'+i.relevance+'">'+esc(L.relevance[i.relevance]||i.relevance)+'</span>';if(days(i.first_seen)<=7)tags+='<span class="tag badge-new">جديد</span>';
i.topics.forEach(function(t){tags+='<span class="tag">'+esc(L.topic[t]||t)+'</span>'});if(i.file)tags+='<span class="tag"><a href="'+esc(i.file)+'" target="_blank" rel="noopener">PDF ⬇</a></span>';if(i.mirrors)tags+='<span class="tag">+'+i.mirrors+' نسخة</span>';tags+='<span class="tag" dir="ltr">'+esc(i.source)+'</span>';
el.innerHTML='<div class="meta">'+meta+'</div><h3><a'+dir+' href="'+esc(i.url)+'" target="_blank" rel="noopener">'+esc(i.title)+'</a></h3>'+(i.summary?'<p class="sum"'+(isLatin(i.summary)?' dir="ltr"':'')+'>'+esc(i.summary)+'</p>':'')+'<div class="tags">'+tags+'</div>';return el}
function render(){current=filtered();shown=0;$('#list').innerHTML='';more();$('#count').textContent=current.length+' من '+items.length;try{var o={};Object.keys(F).forEach(function(k){o[k]=F[k].type==='checkbox'?F[k].checked:F[k].value});localStorage.setItem('radar-filters',JSON.stringify(o))}catch(e){}}
function more(){var frag=document.createDocumentFragment();current.slice(shown,shown+PAGE).forEach(function(i){frag.appendChild(card(i))});$('#list').appendChild(frag);shown=Math.min(current.length,shown+PAGE);$('#more').hidden=shown>=current.length}
Object.keys(F).forEach(function(k){F[k].addEventListener(F[k].type==='search'||F[k].type==='date'?'input':'change',render)});
$('#more').addEventListener('click',more);
$('#reset').addEventListener('click',function(){Object.keys(F).forEach(function(k){if(F[k].type==='checkbox')F[k].checked=false;else F[k].value=k==='sort'?'date':''});render()});
function copyText(text,btn,label){var box=$('#briefbox');function show(){box.value=text;box.hidden=false;box.focus();box.select()}
 if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){btn.textContent='تم النسخ ✓';setTimeout(function(){btn.textContent=label},1500)},show)}else show()}
$('#copy').addEventListener('click',function(){var md=current.map(function(i){return '- **'+i.title+'** — '+(i.publisher_ar||i.publisher)+' · '+(i.date||i.first_seen)+' · '+i.url+(i.file?' · PDF: '+i.file:'')}).join('\\n');copyText(md,$('#copy'),'نسخ القائمة (Markdown)')});
/* AI brief: the current view, grouped by topic, with a preamble telling the assistant who we are and what to do */
$('#brief').addEventListener('click',function(){var MAX=150,list=current.slice(0,MAX),groups={};list.forEach(function(i){var t=i.topics[0]||'other';(groups[t]=groups[t]||[]).push(i)});
 var f=[];if(F.q.value)f.push('بحث: '+F.q.value);if(F.rel.value)f.push(L.relevance[F.rel.value]);if(F.cat.value)f.push(L.category[F.cat.value]||F.cat.value);if(F.pub.value)f.push('الناشر: '+F.pub.value);if(F.topic.value)f.push('الموضوع: '+(L.topic[F.topic.value]||F.topic.value));if(F.since.value)f.push('من '+F.since.value);if(F.fresh.value)f.push('رُصد خلال '+F.fresh.value+' يومًا');if(F.pdf.checked)f.push('بملف PDF');
 var out=[];
 out.push('أنت مساعد بحثي لفريق تحرير يتابع التقارير الصادرة عن موريتانيا ويراجعها ويلخّصها للقارئ العربي.');
 out.push('أدناه ما رصدته أداتنا (Tool Researcher by RIM) آليًا من مصادر مؤسسية وبحثية موثوقة. كل عنصر: العنوان كما نشره الناشر، الناشر، تاريخ الوثيقة (أو يوم الرصد إن لم يُذكر)، الرابط، ملخص قصير إن وُجد.');
 out.push('المطلوب منك: (1) لخّص المشهد في فقرة؛ (2) جمّع العناصر في محاور موضوعية واذكر أهم 5–10 تقارير تستحق مراجعة كاملة مع سبب الاختيار؛ (3) أشر إلى ما يبدو مكرّرًا أو ثانويًا؛ (4) اقترح ما ينقص الرصد (جهات أو موضوعات غائبة). لا تختلق تقارير غير مذكورة هنا؛ إن احتجت معلومة غير موجودة فقل ذلك.');
 out.push('');out.push('# موجز الرادار — '+DATA.generated);out.push('النطاق: '+(f.length?f.join(' · '):'كل ما في اللوحة')+'. العدد: '+current.length+(current.length>MAX?' (مُدرج '+MAX+' — ضيّق التصفية للمزيد)':'')+'.');out.push('');
 Object.keys(groups).sort(function(a,b){return groups[b].length-groups[a].length}).forEach(function(t){out.push('## '+(L.topic[t]||(t==='other'?'متفرقات':t))+' ('+groups[t].length+')');groups[t].forEach(function(i){out.push('- '+i.title+' — '+(i.publisher_ar?i.publisher_ar+' / '+i.publisher:i.publisher)+' — '+(i.date||'رُصد '+i.first_seen)+(i.type?' — '+i.type:''));out.push('  '+i.url+(i.file&&i.file!==i.url?' · PDF: '+i.file:''));if(i.summary)out.push('  '+i.summary)});out.push('')});
 copyText(out.join('\\n'),$('#brief'),'نسخ موجزًا للذكاء الاصطناعي')});
$('#csv').addEventListener('click',function(){var cols=['title','url','file','date','first_seen','publisher','publisher_ar','type','lang','relevance','topics','source','tier','category','summary'];var rows=[cols.join(',')].concat(current.map(function(i){return cols.map(function(c){var v=i[c];if(Array.isArray(v))v=v.join('|');v=String(v==null?'':v);return '"'+v.replace(/"/g,'""')+'"'}).join(',')}));var blob=new Blob(['\\ufeff'+rows.join('\\r\\n')],{type:'text/csv;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='radar-'+DATA.generated+'.csv';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500)});
var ht=$('#health');ht.innerHTML='<tr><th>المصدر</th><th>الحالة</th><th>مقبول</th><th>آخر تشغيل</th><th>ملاحظة</th></tr>'+DATA.health.map(function(h){return '<tr><td dir="ltr">'+esc(h.id)+'</td><td>'+esc(h.status)+'</td><td>'+h.kept+'</td><td>'+esc(h.last_run)+'</td><td class="'+(h.error?'err':'')+'" dir="ltr">'+esc(h.error)+'</td></tr>'}).join('');
render();
})();
</script>
</body>
</html>
`
}
