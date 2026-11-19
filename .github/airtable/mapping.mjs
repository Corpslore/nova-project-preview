// How Airtable rows become the site's JSON files, and back (for the one-time seed).
// The site reads only the JSON in src/data/airtable/, so it builds and runs without Airtable.

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""))
const str = (v) => (typeof v === "string" ? v.trim() : undefined)

export const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)

/** Airtable events row -> site event. `image` is filled in by the sync after the file is downloaded. */
export function eventFromRow(r) {
  const f = r.fields
  const title = str(f.title)
  if (!title || !f.start_datetime) return null
  return clean({
    id: r.id,
    title,
    start: f.start_datetime,
    end: f.end_datetime,
    category: f.category,
    location: str(f.location_name),
    address: str(f.address),
    description: str(f.description),
    rsvpUrl: str(f.external_rsvp_url),
    slug: str(f.slug) || `${slugify(title)}-${String(f.start_datetime).slice(0, 10)}`,
  })
}

export function rowFromEvent(e) {
  return clean({
    title: e.title,
    start_datetime: e.start,
    end_datetime: e.end,
    category: e.category,
    location_name: e.location,
    address: e.address,
    description: e.description,
    external_rsvp_url: e.rsvpUrl,
    slug: e.slug,
    published: true,
  })
}

/** Airtable offices row -> the site's Position shape (src/components/Positions.tsx). */
export function officeFromRow(r) {
  const f = r.fields
  const office = str(f.office)
  if (!office || !str(f.what) || !str(f.link_url)) return null
  return clean({
    id: r.id,
    order: typeof f.order === "number" ? f.order : undefined,
    office,
    where: str(f.where) ?? "",
    seats: str(f.seats),
    what: str(f.what),
    link: { label: str(f.link_label) || "More information", url: str(f.link_url) },
  })
}

export function rowFromOffice(o, i) {
  return clean({
    office: o.office,
    order: o.order ?? i + 1,
    where: o.where,
    seats: o.seats,
    what: o.what,
    link_label: o.link.label,
    link_url: o.link.url,
    published: true,
  })
}
