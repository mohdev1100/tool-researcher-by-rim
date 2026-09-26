// Notifications for new items: Telegram (bot token + chat id) and a generic JSON webhook.
// Secrets come from the environment (or radar/.env, which is git-ignored):
//   RADAR_TELEGRAM_TOKEN, RADAR_TELEGRAM_CHAT, RADAR_WEBHOOK_URL

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { postJson } from './fetch.mjs'

export async function loadEnv(path) {
  if (!existsSync(path)) return
  const text = await readFile(path, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const k = line.slice(0, eq).trim()
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}

const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

export function telegramMessages(newItems, { today, max = 20 }) {
  const direct = newItems.filter(i => i.relevance === 'direct')
  const regional = newItems.filter(i => i.relevance === 'regional')
  if (!direct.length && !regional.length) return []
  const lines = []
  lines.push(`<b>رادار التقارير — ${today}</b>`)
  lines.push(`جديد: ${direct.length} عن موريتانيا مباشرة${regional.length ? ` · ${regional.length} إقليمي` : ''}`)
  lines.push('')
  const fmt = (i, n) => `${n}. <a href="${esc(i.url)}">${esc(i.title)}</a>\n   ${esc(i.publisher_ar || i.publisher)} · ${i.date || 'بلا تاريخ'}${i.file ? ` · <a href="${esc(i.file)}">PDF</a>` : ''}`
  direct.slice(0, max).forEach((i, n) => lines.push(fmt(i, n + 1)))
  if (direct.length > max) lines.push(`… و${direct.length - max} أخرى في اللوحة`)
  if (regional.length) {
    lines.push('')
    lines.push('<i>إقليمي يشمل موريتانيا:</i>')
    regional.slice(0, Math.max(3, Math.floor(max / 3))).forEach((i, n) => lines.push(fmt(i, n + 1)))
  }
  // Telegram caps a message at 4096 characters; split on line boundaries.
  const chunks = []
  let cur = ''
  for (const l of lines) {
    if ((cur + '\n' + l).length > 3900) { chunks.push(cur); cur = l } else cur = cur ? cur + '\n' + l : l
  }
  if (cur) chunks.push(cur)
  return chunks
}

export async function notify(newItems, { today, max }) {
  const out = []
  const token = process.env.RADAR_TELEGRAM_TOKEN, chat = process.env.RADAR_TELEGRAM_CHAT, hook = process.env.RADAR_WEBHOOK_URL
  if (!token && !hook) return [{ channel: 'none', ok: false, note: 'no RADAR_TELEGRAM_TOKEN/RADAR_TELEGRAM_CHAT or RADAR_WEBHOOK_URL configured' }]
  if (token && chat) {
    for (const text of telegramMessages(newItems, { today, max })) {
      const r = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true })
      out.push({ channel: 'telegram', ok: r.ok, note: r.ok ? '' : r.body.slice(0, 200) })
    }
    if (!out.length) out.push({ channel: 'telegram', ok: true, note: 'nothing new — no message sent' })
  } else if (token || chat) {
    out.push({ channel: 'telegram', ok: false, note: 'both RADAR_TELEGRAM_TOKEN and RADAR_TELEGRAM_CHAT are needed' })
  }
  if (hook) {
    const direct = newItems.filter(i => i.relevance === 'direct')
    const text = telegramMessages(newItems, { today, max }).join('\n').replace(/<[^>]+>/g, '')
    const r = await postJson(hook, { text, date: today, new_direct: direct.length, new_total: newItems.length, items: newItems.slice(0, 100) })
    out.push({ channel: 'webhook', ok: r.ok, note: r.ok ? '' : r.body.slice(0, 200) })
  }
  return out
}
