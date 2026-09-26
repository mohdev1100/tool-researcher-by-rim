// HTTP fetching with a browser identity, time-outs, retries and conditional requests,
// plus a curl fallback: some CDN bot filters (AWS WAF in front of ReliefWeb and HDX, for one) answer
// Node's TLS fingerprint with an empty "202 Accepted" and let curl through.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// Two identities. The honest one names the tool and its home; it ends with the curl token because the AWS WAF
// in front of ReliefWeb and HDX challenges every identity it cannot classify (a claimed browser without a
// browser's fingerprint, a bare custom name) and passes the known HTTP tools (curl, wget, python-requests) —
// measured 2026-09-25 — and curl 8.21 is indeed our fallback client. Some other fronts (IMF's Akamai) refuse
// anything that is not a browser, so the browser identity is the second try.
export const HONEST_UA = 'Researcher/1.0 curl/8.21.0'
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
export const UA = BROWSER_UA

const DEFAULT_ACCEPT = 'application/json, application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7'
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * fetchText(url, opts) → { status, ok, notModified, body, contentType, etag, lastModified, finalUrl, error }
 * opts: timeout (ms), retries, headers, etag, lastModified, kind ('html' | 'api' | 'rss'), ua
 */
export async function fetchText(url, opts = {}) {
  const { timeout = 40000, retries = 2, headers = {}, etag = '', lastModified = '', kind = '', ua = UA } = opts
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const h = {
        'user-agent': ua,
        accept: kind === 'html' ? HTML_ACCEPT : DEFAULT_ACCEPT,
        'accept-language': 'ar,fr;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        ...headers,
      }
      if (etag) h['if-none-match'] = etag
      if (lastModified) h['if-modified-since'] = lastModified
      const res = await fetch(url, { headers: h, redirect: 'follow', signal: ctrl.signal })
      const contentType = res.headers.get('content-type') || ''
      if (res.status === 304) {
        return { status: 304, ok: true, notModified: true, body: '', contentType, etag, lastModified, finalUrl: res.url, error: '' }
      }
      const body = await res.text()
      const out = {
        status: res.status, ok: res.ok, notModified: false, body, contentType,
        etag: res.headers.get('etag') || '', lastModified: res.headers.get('last-modified') || '',
        finalUrl: res.url, error: res.ok ? '' : `HTTP ${res.status}`,
      }
      if ((res.status >= 500 || res.status === 429 || res.status === 408) && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status}`)
        await sleep(1500 * (attempt + 1))
        continue
      }
      return out
    } catch (e) {
      lastErr = e
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue }
    } finally {
      clearTimeout(timer)
    }
  }
  const msg = lastErr ? (lastErr.name === 'AbortError' ? `timeout after ${timeout} ms` : String(lastErr.message || lastErr)) : 'unknown error'
  return { status: 0, ok: false, notModified: false, body: '', contentType: '', etag: '', lastModified: '', finalUrl: url, error: msg }
}

let curlKnown = null
export async function curlAvailable() {
  if (curlKnown != null) return curlKnown
  try { await execFileP('curl', ['--version'], { timeout: 10000, windowsHide: true }); curlKnown = true } catch { curlKnown = false }
  return curlKnown
}

/** Same contract as fetchText, through the system curl. */
export async function fetchViaCurl(url, opts = {}) {
  const { timeout = 40000, headers = {}, kind = '', ua = HONEST_UA } = opts
  const args = ['-sS', '-L', '--compressed', '-A', ua, '--max-time', String(Math.ceil(timeout / 1000)), '--max-redirs', '10',
    '-H', `accept: ${kind === 'html' ? HTML_ACCEPT : DEFAULT_ACCEPT}`, '-H', 'accept-language: ar,fr;q=0.9,en;q=0.8']
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  args.push('-w', '\n__RADAR__%{http_code}|%{content_type}|%{url_effective}', '--', url)
  const empty = { notModified: false, etag: '', lastModified: '', via: 'curl' }
  try {
    const { stdout } = await execFileP('curl', args, { maxBuffer: 64 * 1024 * 1024, timeout: timeout + 10000, windowsHide: true, encoding: 'utf8' })
    const i = stdout.lastIndexOf('\n__RADAR__')
    if (i < 0) return { ...empty, status: 0, ok: false, body: '', contentType: '', finalUrl: url, error: 'curl: no status trailer' }
    const [code, contentType, finalUrl] = stdout.slice(i + 10).trim().split('|')
    const status = Number(code) || 0
    const ok = status >= 200 && status < 300
    return { ...empty, status, ok, body: stdout.slice(0, i), contentType: contentType || '', finalUrl: finalUrl || url, error: ok ? '' : `HTTP ${status}` }
  } catch (e) {
    const msg = String((e && (e.stderr || e.message)) || e).trim().split('\n')[0].slice(0, 200)
    return { ...empty, status: 0, ok: false, body: '', contentType: '', finalUrl: url, error: 'curl: ' + msg }
  }
}

/** POST a JSON body (used for notifications). */
export async function postJson(url, payload, opts = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 20000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA, ...(opts.headers || {}) },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    const text = await res.text()
    return { status: res.status, ok: res.ok, body: text }
  } catch (e) {
    return { status: 0, ok: false, body: String(e.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/** Run async jobs with a concurrency limit; returns results in input order. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try { results[i] = await fn(items[i], i) } catch (e) { results[i] = { error: String(e && e.message || e) } }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
