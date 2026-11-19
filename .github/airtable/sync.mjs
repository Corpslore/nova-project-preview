// Copies published events and offices from the NoVA Project's Airtable base into airtable/*.json, and
// event images into airtable/events/, in the published site's repo. The site loads those files when a
// page opens (src/data/live.ts), so Airtable edits reach pnova.org without rebuilding the site.
//
// Run by .github/workflows/airtable-sync.yml. Source of truth: pages-repo/ and airtable/mapping.mjs
// in the site project (scripts/deploy-pages.sh copies them here).
//   AIRTABLE_TOKEN  read-only Airtable token (scope data.records:read, this base only)
//   AIRTABLE_BASE   the base id
//   AIRTABLE_API_URL  only for tests against a stand-in; defaults to api.airtable.com
// Each run makes 2 Airtable API calls (more only past 100 rows a table). The free plan allows 1,000 a month.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"
import { eventFromRow, officeFromRow } from "./mapping.mjs"

const token = process.env.AIRTABLE_TOKEN
const base = process.env.AIRTABLE_BASE
const api = (process.env.AIRTABLE_API_URL || "https://api.airtable.com").replace(/\/$/, "")
const outDir = process.env.OUT_DIR || "airtable"
const imgDir = join(outDir, "events")
const MAX_IMAGE = 5 * 1024 * 1024
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"])

if (!token) {
  console.log("::notice::No AIRTABLE_TOKEN secret is set, so nothing was synced. The site keeps the files it has.")
  process.exit(0)
}
if (!/^app[A-Za-z0-9]{14}$/.test(base || "")) {
  console.error("AIRTABLE_BASE must be an Airtable base id (app followed by 14 letters or digits).")
  process.exit(1)
}

async function list(table, params) {
  const out = []
  let offset
  do {
    const q = new URLSearchParams({ ...params, ...(offset ? { offset } : {}) })
    let res
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${api}/v0/${base}/${table}?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      // Airtable allows 5 requests a second per base and answers 429 above that.
      if (res.status !== 429 || attempt >= 4) break
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`Airtable ${table}: ${res.status} ${text.slice(0, 300)}`)
    const page = JSON.parse(text)
    out.push(...(page.records ?? []))
    offset = page.offset
  } while (offset)
  return out
}

const published = (field) => ({ filterByFormula: "{published}", "sort[0][field]": field, "sort[0][direction]": "asc" })
const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u)

async function saveImage(rec, att) {
  if (!/^image\//.test(att.type || "")) return undefined
  let ext = extname(att.filename || "").toLowerCase()
  if (!IMAGE_EXT.has(ext)) ext = ".jpg"
  const file = `${rec}-${att.id}${ext}`.replace(/[^\w.-]/g, "")
  const dest = join(imgDir, file)
  if (!existsSync(dest)) {
    const src = att.thumbnails?.large?.url || att.url
    let buf
    try {
      const res = await fetch(src)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      buf = Buffer.from(await res.arrayBuffer())
    } catch (err) {
      // One bad image shouldn't stop the event (or the whole sync) from publishing.
      console.warn(`events: image on ${rec} could not be downloaded (${err.message}), left out`)
      return undefined
    }
    if (buf.length > MAX_IMAGE) {
      console.warn(`events: image on ${rec} is over 5 MB, left out`)
      return undefined
    }
    mkdirSync(imgDir, { recursive: true })
    writeFileSync(dest, buf)
  }
  return `airtable/events/${file}`
}

const eventRows = await list("events", published("start_datetime"))
const events = []
for (const row of eventRows) {
  const e = eventFromRow(row)
  if (!e) {
    console.warn(`events: skipped ${row.id} (title or start time is empty)`)
    continue
  }
  if (e.rsvpUrl && !isHttp(e.rsvpUrl)) {
    console.warn(`events: ${row.id} has an RSVP link that isn't a web address, left out`)
    delete e.rsvpUrl
  }
  const att = row.fields.image?.[0]
  if (att) {
    const image = await saveImage(row.id, att)
    if (image) e.image = image
  }
  events.push(e)
}

const offices = []
for (const row of await list("offices", published("order"))) {
  const o = officeFromRow(row)
  if (!o || !isHttp(o.link.url)) console.warn(`offices: skipped ${row.id} (office, what or a web link is missing)`)
  else offices.push(o)
}

let changed = 0
for (const [name, items] of [
  ["events", events],
  ["offices", offices],
]) {
  const file = join(outDir, `${name}.json`)
  const before = existsSync(file) ? readFileSync(file, "utf8") : ""
  const prev = before ? JSON.parse(before) : []
  // A table with nothing published is more often a mistake than a choice: keep the last good copy.
  if (!items.length && prev.length) {
    console.warn(`::warning::${name}: nothing is ticked "published" in Airtable, so the site keeps its previous ${prev.length}.`)
    continue
  }
  const next = JSON.stringify(items, null, 2) + "\n"
  if (next !== before) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(file, next)
    changed++
  }
  console.log(`${name}: ${items.length} published${next !== before ? " (updated)" : ""}`)
}
console.log(changed ? "Done: files updated." : "Done: nothing changed.")
