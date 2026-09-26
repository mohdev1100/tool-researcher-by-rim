import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseFeed } from '../lib/rss.mjs'
import { parseApi } from '../lib/api.mjs'
import { parseHtml } from '../lib/html.mjs'
import { parseDate, findDate } from '../lib/dates.mjs'
import { clean, normalizeUrl, normText, titleKey } from '../lib/text.mjs'
import { makeMatchers, relevance, isReportLike, topicsFor } from '../lib/filter.mjs'
import { Store } from '../lib/store.mjs'

const fx = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'))
const m = makeMatchers(config)

test('dates: the shapes feeds and APIs hand us', () => {
  assert.equal(parseDate('2026-09-25T04:00:00Z'), '2026-09-25')
  assert.equal(parseDate('Thu, 25 Sep 2026 04:00:00 GMT'), '2026-09-25')
  assert.equal(parseDate('Wed, 29 Nov 2023 05:00:00 +0000'), '2023-11-29')
  assert.equal(parseDate('25 septembre 2026'), '2026-09-25')
  assert.equal(parseDate('1er août 2026'), '2026-08-01')
  assert.equal(parseDate('September 25, 2026'), '2026-09-25')
  assert.equal(parseDate('٢٥ سبتمبر ٢٠٢٦'), '2026-09-25')
  assert.equal(parseDate('25 أغسطس 2026'), '2026-08-25')
  assert.equal(parseDate('12 جوان 2026'), '2026-06-12')
  assert.equal(parseDate('3 كانون الثاني 2026'), '2026-01-03')
  assert.equal(parseDate('20260925T143000Z'), '2026-09-25')
  assert.equal(parseDate('09-September-2025'), '2025-09-09')
  assert.equal(parseDate('Reference Date: 09-September-2025'), '2025-09-09')
  assert.equal(parseDate('25/09/2026'), '2026-09-25')
  assert.equal(parseDate('2026/09/25'), '2026-09-25')
  assert.equal(parseDate([2026, 12, 31]), '2026-12-31')
  assert.equal(parseDate({ 'date-parts': [[2026, 9]] }), '2026-09-01')
  assert.equal(parseDate(1790365316), '2026-09-25')
  assert.equal(parseDate('not a date'), null)
  assert.equal(parseDate('31/02/2026'), null)
  assert.equal(findDate('Publié le 12 mars 2026 par la BCM — 76 pages'), '2026-03-12')
  assert.equal(findDate('Sahel 2026 outlook released 2026-02-01'), '2026-02-01')
  assert.equal(findDate('نشر في 15 مايو 2026'), '2026-05-15')
})

test('text: entities, double encoding, urls, arabic keys', () => {
  assert.equal(clean('&lt;p&gt;Tom &amp;amp; Jerry&lt;/p&gt;'), 'Tom & Jerry')
  assert.equal(normalizeUrl('http://www.Example.org/a/b/?utm_source=x&id=2#top'), 'https://example.org/a/b/?id=2')
  assert.equal(normalizeUrl('https://example.org/report/'), 'https://example.org/report')
  assert.equal(normText('الموريتانيّة'), 'الموريتانيه')
  assert.equal(titleKey('  Rapport — Mauritanie : 2026!  '), 'rapport mauritanie 2026')
})

test('rss: crisis group (RSS 2.0)', async () => {
  const f = parseFeed(await fx('crisisgroup.rss.xml'), 'https://www.crisisgroup.org/rss')
  assert.ok(f.items.length >= 5)
  for (const it of f.items) { assert.ok(it.title); assert.match(it.url, /^https:\/\/www\.crisisgroup\.org\//) }
  assert.ok(f.items.some(it => it.date && it.date.startsWith('2026')))
  assert.ok(f.items[0].summary.length > 20)
  assert.doesNotMatch(f.items[0].summary, /</)
})

test('rss: amnesty country feed (WordPress, CDATA creator)', async () => {
  const f = parseFeed(await fx('amnesty-mauritania.rss.xml'))
  assert.ok(f.items.length >= 5)
  assert.ok(f.items.every(it => it.url.startsWith('https://www.amnesty.org/')))
  assert.ok(f.items.every(it => it.date))
  assert.equal(f.items[0].author, 'Amnesty International')
})

test('rss: reliefweb search feed', async () => {
  const f = parseFeed(await fx('reliefweb-mauritania.rss.xml'))
  assert.ok(f.items.length >= 5)
  assert.ok(f.items.every(it => it.url.startsWith('https://reliefweb.int/')))
  assert.ok(f.items.filter(it => it.date).length >= f.items.length - 1)
})

test('atom: github releases', async () => {
  const f = parseFeed(await fx('github-releases.atom.xml'))
  assert.equal(f.isAtom, true)
  assert.ok(f.items.length >= 5)
  assert.match(f.items[0].url, /^https:\/\/github\.com\/nodejs\/node\/releases\/tag\//)
  assert.match(f.items[0].date, /^\d{4}-\d{2}-\d{2}$/)
  assert.doesNotMatch(f.items[0].summary, /<h3>/)
})

test('api: world bank documents', async () => {
  const items = parseApi(JSON.parse(await fx('worldbank-wds.json')), { items: 'documents', title: 'display_title', url: 'url', file: 'pdfurl', date: 'docdt', type: 'docty', lang: 'lang' })
  assert.ok(items.length >= 3)
  assert.match(items[0].date, /^2026-/)
  assert.match(items[0].file, /\.pdf$/)
  assert.match(items[0].url, /^https?:\/\/documents\.worldbank\.org\//)
  assert.ok(items[0].type)
})

test('api: openalex + crossref + hdx', async () => {
  const oa = parseApi(JSON.parse(await fx('openalex.json')), { items: 'results', title: 'title', url: ['primary_location.landing_page_url', 'doi', 'id'], file: 'open_access.oa_url', date: 'publication_date', type: 'type', publisher: 'primary_location.source.display_name' })
  assert.ok(oa.length >= 3)
  assert.match(oa[0].url, /^https:\/\//)
  assert.match(oa[0].date, /^2026-/)
  const cr = parseApi(JSON.parse(await fx('crossref.json')), { items: 'message.items', title: 'title.0', url: 'URL', date: 'published', type: 'type', publisher: 'publisher' })
  assert.ok(cr.length >= 2)
  assert.match(cr[0].url, /^https:\/\/doi\.org\//)
  assert.match(cr[0].date, /^2026-/)
  assert.ok(cr[0].publisher)
  const hdx = parseApi(JSON.parse(await fx('hdx.json')), { items: 'result.results', title: 'title', url: 'name', url_prefix: 'https://data.humdata.org/dataset/', date: 'metadata_modified', summary: 'notes', publisher: 'organization.title', tags: 'tags', type: '=dataset' })
  assert.ok(hdx.length >= 3)
  assert.match(hdx[0].url, /^https:\/\/data\.humdata\.org\/dataset\//)
  assert.ok(hdx[0].tags.length >= 1)
  assert.equal(hdx[0].type, 'dataset')
})

test('html: link mode picks anchors and nearby dates; item mode uses named groups', () => {
  const page = `<html><body><nav><a href="/about">About us</a></nav><main>
    <div class="row"><a href="/publications/rapport-annuel-2025.pdf">Rapport annuel de la BCM 2025</a><span class="date">12 mars 2026</span></div>
    <div class="row"><span class="date">2026-01-20</span><a href="/publications/note-conjoncture">Note de conjoncture — 4e trimestre</a></div>
    <div class="row"><a href="/publications/old"><img src="x.png"></a><a href="/publications/old">Bulletin statistique mensuel</a> · 05/02/2026</div>
    </main></body></html>`
  const items = parseHtml(page, { link: '/publications/', section: '<main' }, 'https://www.bcm.mr/')
  assert.equal(items.length, 3)
  assert.equal(items[0].url, 'https://www.bcm.mr/publications/rapport-annuel-2025.pdf')
  assert.equal(items[0].file, items[0].url)
  assert.equal(items[0].date, '2026-03-12')
  assert.equal(items[1].date, '2026-01-20')
  assert.equal(items[2].title, 'Bulletin statistique mensuel')
  assert.equal(items[2].date, '2026-02-05')
  // item mode: the regex is bounded to one row; the date comes from the named group when present, else from the row text
  const rx = parseHtml(page, { item: '<div class="row">(?:(?!</div>).)*?<a href="(?<url>[^"]+)">(?<title>[^<]{8,})</a>(?:(?!</div>).)*?</div>', flags: 'isu' }, 'https://www.bcm.mr/')
  assert.equal(rx.length, 3)
  assert.deepEqual(rx.map(i => i.date), ['2026-03-12', '2026-01-20', '2026-02-05'])
  const rx2 = parseHtml(page, { item: '<a href="(?<url>/publications/[^"]+)">(?<title>[^<]{8,})</a><span class="date">(?<date>[^<]+)</span>', flags: 'is' }, 'https://www.bcm.mr/')
  assert.equal(rx2.length, 1)
  assert.equal(rx2[0].date, '2026-03-12')
})

test('filter: relevance, arabic prefixes, regional, report-likeness, topics', () => {
  const src = { scope: 'global' }
  assert.equal(relevance({ title: 'IMF Country Report No. 26/12: Islamic Republic of Mauritania', summary: '' }, src, m), 'direct')
  assert.equal(relevance({ title: 'Rapport sur la situation économique en Mauritanie', summary: '' }, src, m), 'direct')
  assert.equal(relevance({ title: 'تقرير عن الوضع الاقتصادي بموريتانيا', summary: '' }, src, m), 'direct')
  assert.equal(relevance({ title: 'الحكومة الموريتانية تنشر تقريرها السنوي', summary: '' }, src, m), 'direct')
  assert.equal(relevance({ title: 'Sahel food security outlook', summary: '' }, src, m), 'regional')
  assert.equal(relevance({ title: 'تقرير حول منطقة الساحل', summary: '' }, src, m), 'regional')
  assert.equal(relevance({ title: 'Ukraine reconstruction update', summary: '' }, src, m), null)
  assert.equal(relevance({ title: 'Anything', summary: '' }, { scope: 'mauritania' }, m), 'direct')
  assert.equal(relevance({ title: 'Yemen: funding needs', summary: '' }, { scope: 'regional' }, m), 'regional')
  assert.equal(relevance({ title: 'WFP Mauritania Country Brief', summary: '' }, { scope: 'regional' }, m), 'direct')
  assert.equal(isReportLike({ title: 'Mauritania: Country Report 2026', summary: '' }, m), true)
  assert.equal(isReportLike({ title: 'صدور تقرير جديد عن الهجرة', summary: '' }, m), true)
  assert.equal(isReportLike({ title: 'President visits Nouakchott', summary: '' }, m), false)
  assert.equal(isReportLike({ title: 'Job opening: Country Report Officer', summary: '' }, m), false)
  // Arabic report words are matched as words (with clitic prefixes and nominal suffixes), not as substrings
  assert.equal(isReportLike({ title: 'موريتانيا وتركيا تبحثان تعزيز تعاونهما', summary: '' }, m), false)
  assert.equal(isReportLike({ title: 'وزير الشؤون السياسية يستقبل السفير', summary: '' }, m), false)
  assert.equal(isReportLike({ title: 'صدور التقرير السنوي للبنك المركزي', summary: '' }, m), true)
  assert.equal(isReportLike({ title: 'المنظمة تنشر تقريرها حول الهجرة', summary: '' }, m), true)
  assert.equal(isReportLike({ title: 'بيانات جديدة عن التضخم', summary: '' }, m), true)
  assert.equal(isReportLike({ title: 'دراسة: نصف الأسر بلا تأمين', summary: '' }, m), true)
  // strict mode judges the title only
  assert.equal(isReportLike({ title: 'وزير الخارجية يلتقي نظيرته', summary: 'وقد صدر تقرير عن اللقاء' }, m), true)
  assert.equal(isReportLike({ title: 'وزير الخارجية يلتقي نظيرته', summary: 'وقد صدر تقرير عن اللقاء' }, m, true), false)
  assert.equal(isReportLike({ title: 'x', summary: '', file: 'https://x.org/a.pdf' }, m), true)
  assert.deepEqual(topicsFor({ title: 'Mauritania: migration on the Atlantic route to the Canary Islands', summary: '' }), ['migration'])
  assert.ok(topicsFor({ title: 'تقرير عن التعليم والصحة في موريتانيا', summary: '' }).includes('education'))
  assert.ok(topicsFor({ title: 'Green hydrogen and iron ore mining outlook', summary: '' }).includes('mining'))
})

test('store: url dedup, title mirrors, first_seen', () => {
  const s = new Store({ version: 1, updated: null, items: [] })
  const base = { source: 'a', publisher: 'P', relevance: 'direct', tier: 'A', category: 'x', scope: 'mauritania' }
  const r1 = s.upsert({ ...base, title: 'Mauritania Economic Update 2026: Growth and Resilience', url: 'https://www.worldbank.org/x?utm_source=rss', date: '2026-06-01' }, '2026-09-25')
  assert.equal(r1.status, 'new')
  const r2 = s.upsert({ ...base, title: 'Mauritania Economic Update 2026: Growth and Resilience', url: 'http://worldbank.org/x/', date: '2026-06-01' }, '2026-09-26')
  assert.equal(r2.status, 'seen')
  assert.equal(r2.item.last_seen, '2026-09-26')
  const r3 = s.upsert({ ...base, source: 'reliefweb', title: 'Mauritania Economic Update 2026 — Growth and Resilience', url: 'https://reliefweb.int/report/mauritania/y', date: '2026-06-03' }, '2026-09-26')
  assert.equal(r3.status, 'mirror')
  assert.equal(s.items.length, 1)
  assert.equal(s.items[0].mirrors.length, 1)
  const r4 = s.upsert({ ...base, title: 'Short title', url: 'https://a.org/1' }, '2026-09-26')
  const r5 = s.upsert({ ...base, title: 'Short title', url: 'https://b.org/2' }, '2026-09-26')
  assert.equal(r4.status, 'new'); assert.equal(r5.status, 'new')
  assert.equal(s.items.length, 3)
  assert.equal(s.items[1].first_seen, '2026-09-26')
  // key_with_date: the same page re-issued with a new date is a new edition, not a duplicate or a mirror
  const page = { ...base, title: 'Mauritania: Country File, Economic Risk Analysis', url: 'https://coface.example/country/mauritania' }
  const e1 = s.upsert({ ...page, date: '2025-11-01', key_suffix: '#2025-11-01' }, '2026-09-26')
  const e2 = s.upsert({ ...page, date: '2025-11-01', key_suffix: '#2025-11-01' }, '2026-09-27')
  const e3 = s.upsert({ ...page, date: '2026-05-01', key_suffix: '#2026-05-01' }, '2026-10-01')
  assert.equal(e1.status, 'new'); assert.equal(e2.status, 'seen'); assert.equal(e3.status, 'new')
  assert.notEqual(e1.item.id, e3.item.id)
  assert.equal(s.items.length, 5)
})
