#!/usr/bin/env node
// Tool Researcher by RIM — daily radar of new reports about Mauritania.
// Polls reliable publishers (APIs, feeds, listing pages), keeps what is about Mauritania and published
// since the configured date, de-duplicates, and writes a digest, a dashboard and feeds.
//
//   node radar/radar.mjs run     [--since 2026-01-01] [--only id,id] [--skip id,id] [--dry] [--notify] [--verbose] [--no-browser]
//   node radar/radar.mjs check   [--only id,id]                 fetch + parse every source, touch nothing, write out/health.md
//   node radar/radar.mjs render                                 regenerate out/ from data/
//   node radar/radar.mjs list    [--since D] [--relevance direct|regional] [--new N] [--json] [--limit N]
//   node radar/radar.mjs sources                                print the source table
//   node radar/radar.mjs probe   <url>                          detect feed / JSON / HTML and print a draft source entry

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchText, fetchViaCurl, curlAvailable, pool, HONEST_UA, BROWSER_UA } from './lib/fetch.mjs'
import { parseFeed, looksLikeFeed } from './lib/rss.mjs'
import { parseApi } from './lib/api.mjs'
import { parseHtml } from './lib/html.mjs'
import { makeMatchers, relevance, isReportLike, topicsFor } from './lib/filter.mjs'
import { Store, openState, saveJson } from './lib/store.mjs'
import { renderDigest, renderDashboard, renderRss, renderJsonFeed, renderHealth, renderBrief } from './lib/render.mjs'
import { notify, loadEnv } from './lib/notify.mjs'
import { browserAvailable, fetchWithBrowser, closeBrowser } from './lib/browser.mjs'
import { todayISO, parseDate } from './lib/dates.mjs'
import { clean, normalizeUrl } from './lib/text.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PATHS = {
  config: join(ROOT, 'config.json'),
  sources: join(ROOT, 'sources.json'),
  store: join(ROOT, 'data', 'reports.json'),
  state: join(ROOT, 'data', 'state.json'),
  out: join(ROOT, 'out'),
  env: join(ROOT, '.env'),
}

const BOOL = new Set(['dry', 'notify', 'verbose', 'json', 'no-browser', 'no-curl', 'browser', 'help', 'all', 'curl', 'replace'])

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) { args[a.slice(2, eq)] = a.slice(eq + 1); continue }
      const k = a.slice(2)
      if (BOOL.has(k) || !argv[i + 1] || argv[i + 1].startsWith('--')) args[k] = true
      else args[k] = argv[++i]
    } else args._.push(a)
  }
  return args
}

function expand(url, ctx) {
  return url.replace(/\{since\}/g, ctx.since).replace(/\{year\}/g, ctx.today.slice(0, 4)).replace(/\{today\}/g, ctx.today)
}

function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s }

function newestDate(items) {
  let best = null
  for (const it of items) if (it.date && (!best || it.date > best)) best = it.date
  return best
}

function normalizeItem(raw, source) {
  const tags = [...(raw.categories || []), ...(raw.tags || [])].map(t => clean(t)).filter(Boolean)
  // Publisher: the source's own name, unless the source is an aggregator (publisher_from_item) or names the
  // real publisher inside the item text (publisher_regex, first capture group, tested on the raw HTML).
  let publisher = source.publisher
  let publisher_ar = source.publisher_ar || source.name_ar || ''
  if (source.publisher_regex) {
    const mm = String(raw.raw || raw.summary || '').match(new RegExp(source.publisher_regex, 'i'))
    if (mm && mm[1] && clean(mm[1])) { publisher = clean(mm[1]); publisher_ar = '' }
  } else if (source.publisher_from_item && raw.publisher && clean(raw.publisher)) {
    publisher = clean(raw.publisher); publisher_ar = ''
  }
  let summary = raw.summary || ''
  if (source.summary_strip) {
    const re = new RegExp(source.summary_strip, 'gi')
    summary = raw.raw ? clean(String(raw.raw).replace(re, ' ')) : clean(summary.replace(re, ' '))
    if (summary.length > 600) summary = summary.slice(0, 600) + '…'
  }
  return {
    title: clean(raw.title),
    url: String(raw.url || '').trim(),
    file: String(raw.file || '').trim(),
    date: raw.date || null,
    summary,
    lang: (raw.lang || source.language || '').toLowerCase().slice(0, 2) === 'mi' ? '' : (raw.lang || source.language || ''),
    type: raw.type || '',
    tags,
    author: raw.author || '',
    publisher,
    publisher_ar,
    source: source.id,
    source_name: source.name,
    tier: source.tier,
    category: source.category,
    scope: source.scope,
  }
}

/** A response is "bad" when it is not 2xx or its body cannot be what this source's kind expects. */
function badResponse(source, r) {
  if (!r.ok) return true
  if (r.notModified) return false
  const b = stripBom(r.body || '').trim()
  if (!b) return true
  if (source.kind === 'rss') return !looksLikeFeed(b)
  if (source.kind === 'api') return !/^[\[{]/.test(b)
  return false
}

/**
 * Fetch attempts, in order, until one yields a usable body for this source's kind:
 *   1. Node fetch, honest identity (conditional request)   — what we are; passes AWS WAF (ReliefWeb, HDX)
 *   2. Node fetch, browser identity                         — for fronts that refuse non-browsers (IMF)
 *   3. system curl, honest identity                         — a different TLS stack
 *   4. Playwright browser                                   — JS challenges, JS-rendered listings (local only)
 * A source can pin an identity with "ua": "honest" | "browser", start elsewhere with "fetcher": "curl" | "browser",
 * or opt out of the browser with "browser": false. The state remembers which attempt worked last time and
 * tries it first.
 */
async function fetchSource(source, ctx, { conditional }) {
  const url = expand(source.url, ctx)
  const st = ctx.state.sources[source.id] || {}
  const timeout = source.timeout_ms || ctx.config.timeout_ms
  const opts = { timeout, kind: source.kind, headers: resolveHeaders(source.headers) }
  let order = [
    { how: 'fetch', ua: HONEST_UA, label: 'fetch' },
    { how: 'fetch', ua: BROWSER_UA, label: 'fetch:browser-ua' },
    { how: 'curl', label: 'curl' },
    { how: 'browser', label: 'browser' },
  ]
  if (source.ua === 'browser') order = order.filter(o => o.label !== 'fetch')
  if (source.ua === 'honest') order = order.filter(o => o.label !== 'fetch:browser-ua')
  if (source.fetcher === 'curl' || source.fetcher === 'browser') order.sort((a, b) => (a.how === source.fetcher ? -1 : 0) - (b.how === source.fetcher ? -1 : 0))
  if (source.browser === true) order.sort((a, b) => (a.how === 'browser' ? -1 : 0) - (b.how === 'browser' ? -1 : 0))
  if (st.via && order.some(o => o.label === st.via)) order.sort((a, b) => (a.label === st.via ? -1 : 0) - (b.label === st.via ? -1 : 0))
  let first = null
  const attempts = []
  for (const o of order) {
    if (o.how === 'curl' && !ctx.curlOk) continue
    if (o.how === 'browser' && (!ctx.browserOk || source.browser === false)) continue
    const r = o.how === 'fetch'
      ? await fetchText(url, { ...opts, ua: o.ua, etag: conditional ? st.etag || '' : '', lastModified: conditional ? st.last_modified || '' : '' })
      : o.how === 'curl' ? await fetchViaCurl(url, opts)
      : await fetchWithBrowser(url, { timeout: Math.max(timeout, 60000) })
    if (r.notModified) return { ...r, via: o.label, url }
    if (!badResponse(source, r)) return { ...r, via: o.label, url }
    attempts.push(`${o.label} ${r.status || r.error || '?'}${r.ok ? ` ${(r.contentType || '').split(';')[0] || 'no type'} ${(r.body || '').length} chars` : ''}`)
    if (!first) first = { ...r, via: o.label }
    if ([404, 410].includes(r.status)) break // a missing page will not appear through another client
  }
  const why = attempts.length ? `no usable response (${attempts.join('; ')})` : 'no fetcher available'
  return { ...(first || { status: 0, notModified: false, body: '', contentType: '', via: 'none' }), ok: false, error: why, url }
}

function parseBody(source, res) {
  const body = stripBom(res.body || '')
  const base = res.finalUrl || res.url
  if (source.kind === 'rss') {
    if (!looksLikeFeed(body)) throw new Error(`not a feed (${(res.contentType || '').split(';')[0] || 'no content-type'}, ${body.length} chars)`)
    return parseFeed(body, base).items
  }
  if (source.kind === 'api') {
    let json
    try { json = JSON.parse(body) } catch (e) { throw new Error(`not JSON (${(res.contentType || '').split(';')[0]}): ${body.slice(0, 80).replace(/\s+/g, ' ')}`) }
    return parseApi(json, source.api)
  }
  return parseHtml(body, source.html || {}, base)
}

async function runSource(source, ctx, { conditional }) {
  const started = Date.now()
  let res
  try { res = await fetchSource(source, ctx, { conditional }) } catch (e) { return { source, status: 'error', error: String(e.message || e), ms: Date.now() - started } }
  if (res.notModified) return { source, status: 'not-modified', http: 304, raw: 0, kept: [], reasons: {}, ms: Date.now() - started, etag: res.etag, last_modified: res.lastModified }
  if (!res.ok) return { source, status: 'error', http: res.status, error: res.error || `HTTP ${res.status}`, via: res.via, ms: Date.now() - started }
  let raw
  try { raw = parseBody(source, res) } catch (e) { return { source, status: 'error', http: res.status, error: 'parse: ' + e.message, via: res.via, ms: Date.now() - started } }
  const max = source.max_items || ctx.config.max_items_per_source
  const kept = []
  const reasons = { irrelevant: 0, not_report: 0, old: 0, undated: 0, excluded: 0, bad: 0 }
  const onlyReports = source.only_reports != null ? source.only_reports : (source.scope !== 'mauritania' || source.tier === 'C')
  const excludeRe = source.exclude ? new RegExp(source.exclude, 'iu') : null
  for (const r of raw.slice(0, max)) {
    const item = normalizeItem(r, source)
    if (!item.title || !/^https?:\/\//i.test(item.url)) { reasons.bad++; continue }
    if (excludeRe && excludeRe.test(`${item.title} | ${item.type}`)) { reasons.excluded++; continue }
    const rel = relevance(item, source, ctx.m)
    if (!rel) { reasons.irrelevant++; continue }
    const reportLike = isReportLike(item, ctx.m, !!source.strict_reports)
    if (onlyReports && !reportLike) { reasons.not_report++; continue }
    if (item.date && item.date < ctx.since) { reasons.old++; continue }
    if (!item.date && source.require_date) { reasons.undated++; continue }
    // key_with_date: a single page re-issued under one URL (a country file with a "last updated" date) is a new item per date.
    const key_suffix = source.key_with_date && item.date ? '#' + item.date : ''
    kept.push({ ...item, relevance: rel, report_like: reportLike, topics: topicsFor(item), key_suffix })
  }
  return { source, status: 'ok', http: res.status, via: res.via || 'http', raw: raw.length, kept, reasons, newest: newestDate(raw), etag: res.etag || '', last_modified: res.lastModified || '', ms: Date.now() - started }
}

async function loadContext(args) {
  const config = JSON.parse(await readFile(PATHS.config, 'utf8'))
  const sourcesPath = args.sources ? resolve(String(args.sources)) : PATHS.sources
  if (!existsSync(sourcesPath)) throw new Error(`missing ${sourcesPath}`)
  const all = JSON.parse(await readFile(sourcesPath, 'utf8'))
  const list = Array.isArray(all) ? all : all.sources
  const ids = new Set()
  for (const s of list) {
    for (const k of ['id', 'name', 'publisher', 'tier', 'category', 'kind', 'scope', 'url']) if (!s[k]) throw new Error(`source ${s.id || '?'} lacks "${k}"`)
    if (ids.has(s.id)) throw new Error(`duplicate source id ${s.id}`)
    ids.add(s.id)
  }
  const only = args.only ? new Set(String(args.only).split(',').map(s => s.trim())) : null
  const skip = args.skip ? new Set(String(args.skip).split(',').map(s => s.trim())) : new Set()
  // Where are we running? Some hosts refuse datacenter addresses (GitHub's runners) but answer a home connection:
  // such sources carry "skip_on": ["github"] and are left to the local run.
  const runner = String(args.runner || process.env.RADAR_RUNNER || 'local')
  const skippedOnRunner = list.filter(s => s.enabled !== false && Array.isArray(s.skip_on) && s.skip_on.includes(runner))
  const sources = list.filter(s => (s.enabled !== false || args.all) && (!only || only.has(s.id)) && !skip.has(s.id) && !skippedOnRunner.includes(s))
  if (only) for (const id of only) if (!list.some(s => s.id === id)) console.warn(`! unknown source id in --only: ${id}`)
  const today = args.today || todayISO()
  const since = args.since ? (parseDate(args.since) || (() => { throw new Error(`bad --since ${args.since}`) })()) : config.since
  const state = await openState(PATHS.state)
  const browserOk = args['no-browser'] ? false : await browserAvailable()
  const curlOk = args['no-curl'] ? false : await curlAvailable()
  return { config, sources, all: list, today, since, state, m: makeMatchers(config), browserOk, curlOk, verbose: !!args.verbose, runner, skippedOnRunner }
}

/** Header values may name an environment variable ("$S2_API_KEY"); an unset variable drops the header. */
function resolveHeaders(h) {
  const out = {}
  for (const [k, v] of Object.entries(h || {})) {
    if (typeof v === 'string' && v.startsWith('$')) { const val = process.env[v.slice(1)]; if (val) out[k] = val }
    else out[k] = v
  }
  return out
}

function fmtReasons(r) {
  return Object.entries(r || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')
}

async function writeOutputs(ctx, store, { newIds, errors }) {
  await mkdir(PATHS.out, { recursive: true })
  const items = store.sorted()
  const base = { items, state: ctx.state, today: ctx.today, since: ctx.since }
  await writeFile(join(PATHS.out, 'digest.md'), renderDigest({ ...base, newIds, digestDays: ctx.config.digest_days || 14, errors }), 'utf8')
  await writeFile(join(PATHS.out, 'index.html'), renderDashboard({ ...base, sources: ctx.all }), 'utf8')
  await writeFile(join(PATHS.out, 'feed.xml'), renderRss(base), 'utf8')
  await writeFile(join(PATHS.out, 'feed.json'), renderJsonFeed(base), 'utf8')
  await writeFile(join(PATHS.out, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8')
  await writeFile(join(PATHS.out, 'brief.md'), renderBrief({ items, today: ctx.today, days: ctx.config.brief_days || 7 }), 'utf8')
}

/** brief [--days 7] [--relevance direct|regional|all] [--max 150] [--out file]: a paste-ready brief for an AI assistant. */
async function cmdBrief(args) {
  const ctx = await loadContext(args)
  const store = await Store.open(PATHS.store)
  const text = renderBrief({ items: store.sorted(), today: ctx.today, days: Number(args.days || ctx.config.brief_days || 7), relevance: args.relevance || 'direct', max: Number(args.max || 150) })
  if (args.out) { await writeFile(String(args.out), text, 'utf8'); console.log(`wrote ${args.out} (${text.length} chars)`) } else console.log(text)
}

async function cmdRun(args) {
  const ctx = await loadContext(args)
  await loadEnv(PATHS.env)
  const store = await Store.open(PATHS.store)
  console.log(`radar run ${ctx.today} · ${ctx.sources.length} sources · since ${ctx.since} · store ${store.items.length} items${args.dry ? ' · DRY RUN' : ''} · runner ${ctx.runner} · fallbacks: curl ${ctx.curlOk ? 'on' : 'off'}, browser ${ctx.browserOk ? 'on' : 'off'}`)
  if (ctx.skippedOnRunner.length) console.log(`  ○ ${ctx.skippedOnRunner.length} sources are not run on "${ctx.runner}" (they refuse this network): ${ctx.skippedOnRunner.map(s => s.id).join(', ')}`)
  const results = await pool(ctx.sources, ctx.config.concurrency || 4, async source => {
    const r = await runSource(source, ctx, { conditional: !args.dry })
    const tag = r.status === 'ok' ? `ok  ${String(r.raw).padStart(4)} raw → ${String(r.kept.length).padStart(3)} kept` : r.status === 'not-modified' ? 'unchanged' : `ERR ${r.error}`
    console.log(`  ${r.status === 'error' ? '✗' : '✓'} ${source.id.padEnd(34)} ${tag}${r.via && r.via !== 'fetch' ? ` (${r.via})` : ''}${ctx.verbose && r.reasons ? '  [' + fmtReasons(r.reasons) + ']' : ''}`)
    return r
  })
  await closeBrowser()

  const newIds = new Set()
  const newItems = []
  let seen = 0, mirrors = 0
  for (const r of results) {
    if (r.status !== 'ok') continue
    for (const c of r.kept) {
      const { status, item } = store.upsert(c, ctx.today)
      if (status === 'new') { newIds.add(item.id); newItems.push(item) } else if (status === 'mirror') { mirrors++ } else { seen++ }
    }
  }
  const errors = results.filter(r => r.status === 'error').map(r => ({ id: r.source.id, error: r.error }))

  // state
  for (const r of results) {
    const prev = ctx.state.sources[r.source.id] || {}
    ctx.state.sources[r.source.id] = {
      last_run: ctx.today, status: r.status, http: r.http || 0, raw: r.raw == null ? prev.raw || 0 : r.raw,
      kept: r.kept ? r.kept.length : prev.kept || 0, newest: r.newest || prev.newest || null,
      etag: r.status === 'ok' ? r.etag || '' : prev.etag || '', last_modified: r.status === 'ok' ? r.last_modified || '' : prev.last_modified || '',
      error: r.error || '', failures: r.status === 'error' ? (prev.failures || 0) + 1 : 0, via: r.via || 'http', ms: r.ms || 0,
      last_ok: r.status === 'error' ? prev.last_ok || null : ctx.today,
    }
  }
  for (const s of ctx.skippedOnRunner) {
    const prev = ctx.state.sources[s.id] || {}
    // Keep the last real result but say why nothing happened here, so the dashboard's health table is honest.
    ctx.state.sources[s.id] = { ...prev, status: 'skipped', last_run: ctx.today, error: `not run on ${ctx.runner}: this host refuses datacenter addresses — covered by the local run${prev.last_ok ? ` (last local success ${prev.last_ok})` : ''}` }
  }
  ctx.state.runs.push({ at: new Date().toISOString(), today: ctx.today, runner: ctx.runner, sources: results.length, skipped: ctx.skippedOnRunner.length, ok: results.filter(r => r.status !== 'error').length, new: newItems.length, seen, mirrors, dry: !!args.dry })
  ctx.state.runs = ctx.state.runs.slice(-90)

  console.log(`\n${newItems.length} new (${newItems.filter(i => i.relevance === 'direct').length} direct, ${newItems.filter(i => i.relevance === 'regional').length} regional) · ${seen} already known · ${mirrors} mirrors · ${errors.length} source errors`)
  for (const i of newItems.filter(i => i.relevance === 'direct').slice(0, args.dry ? 40 : 15)) console.log(`  + ${i.date || '????-??-??'}  ${i.publisher.slice(0, 28).padEnd(28)}  ${i.title.slice(0, 90)}`)

  if (args.dry) { console.log('\ndry run: nothing written'); return }
  await store.save(PATHS.store, new Date().toISOString())
  await saveJson(PATHS.state, ctx.state)
  await writeOutputs(ctx, store, { newIds, errors })
  // The run's own health sheet (a `check` is the same fetch again; the run already knows how every source fared).
  const skippedRows = ctx.skippedOnRunner.map(s => ({ source: s, status: 'skipped', error: `not run on ${ctx.runner} — covered by the local run` }))
  await writeFile(join(PATHS.out, 'health.md'), renderHealth({ results: [...results, ...skippedRows], today: ctx.today }), 'utf8')
  console.log(`\nwrote data/reports.json (${store.items.length} items), data/state.json, out/digest.md, out/index.html, out/feed.xml, out/feed.json`)
  if (args.notify) {
    const rs = await notify(newItems, { today: ctx.today, max: (ctx.config.notify || {}).max_items || 20 })
    for (const r of rs) console.log(`notify ${r.channel}: ${r.ok ? 'sent' : 'FAILED'} ${r.note || ''}`)
  }
}

async function cmdCheck(args) {
  const ctx = await loadContext(args)
  console.log(`radar check ${ctx.today} · ${ctx.sources.length} sources · fallbacks: curl ${ctx.curlOk ? 'on' : 'off'}, browser ${ctx.browserOk ? 'on' : 'off'}`)
  const results = await pool(ctx.sources, ctx.config.concurrency || 4, async source => {
    const r = await runSource(source, ctx, { conditional: false })
    const mr = r.kept ? r.kept.filter(k => k.relevance === 'direct').length : 0
    const tag = r.status === 'ok' ? `ok  ${String(r.raw).padStart(4)} raw · ${String(r.kept.length).padStart(3)} kept · ${mr} direct · newest ${r.newest || '—'}` : `ERR ${r.error}`
    console.log(`  ${r.status === 'error' ? '✗' : '✓'} ${source.id.padEnd(34)} ${tag}${r.via && r.via !== 'fetch' ? ` (${r.via})` : ''}${ctx.verbose && r.reasons ? '  [' + fmtReasons(r.reasons) + ']' : ''}`)
    if (ctx.verbose && r.kept) for (const k of r.kept.slice(0, 3)) console.log(`      · ${k.date || '????-??-??'} ${k.title.slice(0, 100)}`)
    return r
  })
  await closeBrowser()
  // A check of a temporary --sources file is a test, not the state of the real list: keep health.md for the real list.
  if (!args.sources) {
    await mkdir(PATHS.out, { recursive: true })
    await writeFile(join(PATHS.out, 'health.md'), renderHealth({ results, today: ctx.today }), 'utf8')
  }
  const bad = results.filter(r => r.status === 'error')
  const empty = results.filter(r => r.status === 'ok' && r.raw === 0)
  console.log(`\n${results.length - bad.length} ok · ${bad.length} errors · ${empty.length} parsed to zero items${args.sources ? '' : ' · wrote out/health.md'}`)
  if (bad.length || empty.length) process.exitCode = 1
}

async function cmdRender(args) {
  const ctx = await loadContext(args)
  const store = await Store.open(PATHS.store)
  await writeOutputs(ctx, store, { newIds: new Set(), errors: Object.entries(ctx.state.sources).filter(([, s]) => s.status === 'error').map(([id, s]) => ({ id, error: s.error })) })
  console.log(`rendered ${store.items.length} items into out/`)
}

async function cmdList(args) {
  const store = await Store.open(PATHS.store)
  const today = todayISO()
  let items = store.sorted()
  if (args.since) items = items.filter(i => (i.date || i.first_seen) >= args.since)
  if (args.relevance) items = items.filter(i => i.relevance === args.relevance)
  if (args.new) { const n = Number(args.new); items = items.filter(i => (Date.parse(today) - Date.parse(i.first_seen)) / 864e5 <= n) }
  if (args.source) items = items.filter(i => i.source === args.source)
  items = items.slice(0, Number(args.limit || 100))
  if (args.json) { console.log(JSON.stringify(items, null, 1)); return }
  for (const i of items) console.log(`${i.date || '????-??-??'}  ${(i.relevance === 'direct' ? 'D' : 'R')}  ${i.publisher.slice(0, 26).padEnd(26)}  ${i.title.slice(0, 80)}\n            ${i.url}`)
  console.log(`\n${items.length} shown of ${store.items.length}`)
}

async function cmdSources(args) {
  const ctx = await loadContext({ ...args, all: true })
  for (const s of ctx.all) {
    const st = ctx.state.sources[s.id]
    console.log(`${s.enabled === false ? '○' : '●'} ${s.id.padEnd(34)} ${s.tier} ${s.kind.padEnd(4)} ${s.scope.padEnd(10)} ${(st ? st.status + (st.kept != null ? ' ' + st.kept : '') : 'never run').padEnd(14)} ${s.name}`)
  }
  console.log(`\n${ctx.all.length} sources (${ctx.all.filter(s => s.enabled === false).length} disabled)`)
}

async function cmdProbe(args) {
  const url = args._[1]
  if (!url) throw new Error('usage: probe <url> [--link <regex>] [--item <regex>] [--section <regex>] [--flags is] [--api <json map>] [--curl] [--dump <file>]')
  const fake = { kind: args.item || args.link || args.section ? 'html' : args.api ? 'api' : 'rss' }
  let res = args.curl ? await fetchViaCurl(url, { timeout: 40000, kind: fake.kind }) : await fetchText(url, { timeout: 40000, kind: fake.kind })
  if ((!res.ok || !(res.body || '').trim()) && !args.curl && await curlAvailable()) { const c = await fetchViaCurl(url, { timeout: 40000, kind: fake.kind }); if (c.ok && c.body.trim()) res = c }
  console.log(`HTTP ${res.status} ${res.contentType} · ${res.body.length} chars · via ${res.via || 'fetch'}${res.error ? ' · ' + res.error : ''}`)
  if (!res.ok) return
  const body = stripBom(res.body)
  if (args.dump) { await writeFile(String(args.dump), body, 'utf8'); console.log(`body written to ${args.dump}`) }
  let kind = 'html', items = []
  if (looksLikeFeed(body) && !args.item && !args.link) { kind = 'rss'; items = parseFeed(body, res.finalUrl || url).items }
  else if (/^\s*[\[{]/.test(body)) {
    kind = 'api'
    try {
      const j = JSON.parse(body)
      console.log('JSON top-level keys:', Array.isArray(j) ? `array[${j.length}]` : Object.keys(j).join(', '))
      if (args.api) items = parseApi(j, JSON.parse(String(args.api)))
    } catch (e) { console.log('JSON parse failed:', e.message) }
  } else {
    const cfg = { date_window: Number(args['date-window'] || 400) }
    if (args.link) cfg.link = String(args.link)
    if (args.item) cfg.item = String(args.item)
    if (args.section) cfg.section = String(args.section)
    if (args['section-end']) cfg.section_end = String(args['section-end'])
    if (args.exclude) cfg.exclude = String(args.exclude)
    if (args.flags) cfg.flags = String(args.flags)
    items = parseHtml(body, cfg, res.finalUrl || url)
  }
  console.log(`kind: ${kind} · ${items.length} items parsed`)
  for (const it of items.slice(0, Number(args.limit || 10))) console.log(`  ${it.date || '????-??-??'}  ${it.title.slice(0, 90)}\n            ${it.url}${it.file && it.file !== it.url ? '\n            file: ' + it.file : ''}`)
  const draft = { id: new URL(url).hostname.replace(/^www\./, '').replace(/\W+/g, '-'), name: '', name_ar: '', publisher: '', tier: 'B', category: 'other', kind, scope: 'global', language: 'en', url, enabled: true }
  if (kind === 'api') draft.api = args.api ? JSON.parse(String(args.api)) : { items: '', title: 'title', url: 'url', date: 'date' }
  if (kind === 'html') { draft.html = {}; if (args.link) draft.html.link = String(args.link); if (args.item) draft.html.item = String(args.item); if (args.section) draft.html.section = String(args.section); if (args.flags) draft.html.flags = String(args.flags); draft.html.date_window = Number(args['date-window'] || 400) }
  if (res.via === 'curl') draft.fetcher = 'curl'
  console.log('\ndraft entry for sources.json:\n' + JSON.stringify(draft, null, 2))
}

const REQUIRED = ['id', 'name', 'publisher', 'tier', 'category', 'kind', 'scope', 'url']

/** merge <file...> [--replace]: fold source entries from batch files into sources.json, de-duplicated by id and URL. */
async function cmdMerge(args) {
  const files = args._.slice(1)
  if (!files.length) throw new Error('usage: merge <file.json> [more files] [--replace]')
  const current = existsSync(PATHS.sources) ? JSON.parse(await readFile(PATHS.sources, 'utf8')) : { sources: [] }
  const list = Array.isArray(current) ? current : current.sources
  const byId = new Map(list.map(s => [s.id, s]))
  const byUrl = new Map(list.map(s => [normalizeUrl(s.url), s]))
  let added = 0, replaced = 0, skipped = 0
  for (const f of files) {
    const data = JSON.parse(await readFile(resolve(f), 'utf8'))
    const entries = Array.isArray(data) ? data : data.sources
    if (!Array.isArray(entries)) throw new Error(`${f}: expected {"sources": [...]}`)
    for (const s of entries) {
      const missing = REQUIRED.filter(k => !s[k])
      if (missing.length) { console.warn(`! ${f}: entry ${s.id || '?'} lacks ${missing.join(', ')} — skipped`); skipped++; continue }
      if (!['api', 'rss', 'html'].includes(s.kind)) { console.warn(`! ${s.id}: bad kind ${s.kind} — skipped`); skipped++; continue }
      if (!['mauritania', 'regional', 'global'].includes(s.scope)) { console.warn(`! ${s.id}: bad scope ${s.scope} — skipped`); skipped++; continue }
      if (s.kind === 'api' && !s.api) { console.warn(`! ${s.id}: api source without "api" map — skipped`); skipped++; continue }
      const dupId = byId.get(s.id), dupUrl = byUrl.get(normalizeUrl(s.url))
      const dup = dupId || dupUrl
      if (dup) {
        if (args.replace) { Object.assign(dup, s); replaced++; console.log(`~ replaced ${dup.id}`) } else { skipped++; console.log(`= skipped ${s.id} (same ${dupId ? 'id' : 'url'} as ${dup.id})`) }
        continue
      }
      list.push(s); byId.set(s.id, s); byUrl.set(normalizeUrl(s.url), s); added++
      console.log(`+ ${s.id}`)
    }
  }
  const out = Array.isArray(current) ? list : { ...current, sources: list }
  await writeFile(PATHS.sources, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(`\n${added} added, ${replaced} replaced, ${skipped} skipped → ${list.length} sources in radar/sources.json`)
}

const HELP = `رادار التقارير — usage:
  node radar/radar.mjs run     [--since YYYY-MM-DD] [--only a,b] [--skip a,b] [--dry] [--notify] [--verbose] [--no-browser] [--no-curl]
  node radar/radar.mjs check   [--only a,b] [--verbose] [--sources <file>]
  node radar/radar.mjs render
  node radar/radar.mjs list    [--since D] [--relevance direct|regional] [--new N] [--source id] [--limit N] [--json]
  node radar/radar.mjs sources
  node radar/radar.mjs probe   <url> [--link <regex>] [--item <regex>] [--section <regex>] [--flags is] [--api '<json map>'] [--curl] [--dump <file>]
  node radar/radar.mjs merge   <batch.json> [more...] [--replace]     fold tested entries into sources.json (dedup by id and url)
  node radar/radar.mjs brief   [--days 7] [--relevance direct|regional|all] [--max 150] [--out file]   paste-ready brief for an AI assistant
`

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0] || (args.help ? 'help' : 'run')
const cmds = { run: cmdRun, check: cmdCheck, render: cmdRender, list: cmdList, sources: cmdSources, probe: cmdProbe, merge: cmdMerge, brief: cmdBrief, help: async () => console.log(HELP) }
if (!cmds[cmd]) { console.error(`unknown command "${cmd}"\n` + HELP); process.exit(2) }
cmds[cmd](args).catch(e => { console.error('radar failed:', e && e.stack || e); process.exit(1) })
