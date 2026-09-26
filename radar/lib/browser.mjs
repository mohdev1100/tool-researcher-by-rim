// Optional browser fetcher for hosts that reject plain HTTP clients (IMF's Akamai front, JS-rendered lists).
// Uses the repo's Playwright install when present; the radar works without it.

import { UA } from './fetch.mjs'

let browserPromise = null

export async function browserAvailable() {
  try { await import('playwright'); return true } catch { return false }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = import('playwright').then(pw => pw.chromium.launch({ headless: true }))
  }
  return browserPromise
}

export async function fetchWithBrowser(url, { timeout = 60000, settle = 1500 } = {}) {
  let ctx = null
  try {
    const browser = await getBrowser()
    ctx = await browser.newContext({ userAgent: UA, locale: 'fr-FR', viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
    const status = res ? res.status() : 0
    const contentType = res ? (res.headers()['content-type'] || '') : ''
    let body = ''
    if (/text\/html/i.test(contentType) || !contentType) {
      await page.waitForTimeout(settle)
      body = await page.content()
    } else {
      body = res ? await res.text() : ''
    }
    return { status, ok: status >= 200 && status < 400, notModified: false, body, contentType, etag: '', lastModified: '', finalUrl: page.url(), error: status >= 400 ? `HTTP ${status}` : '', via: 'browser' }
  } catch (e) {
    return { status: 0, ok: false, notModified: false, body: '', contentType: '', etag: '', lastModified: '', finalUrl: url, error: 'browser: ' + String(e.message || e), via: 'browser' }
  } finally {
    if (ctx) await ctx.close().catch(() => {})
  }
}

export async function closeBrowser() {
  if (!browserPromise) return
  const b = await browserPromise.catch(() => null)
  browserPromise = null
  if (b) await b.close().catch(() => {})
}
