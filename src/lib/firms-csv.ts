import { createHash } from "node:crypto";
import type { Detection } from "./hotspots";

function* records(csv: string) {
  let cell = "",
    row: string[] = [],
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell.length === 0) quoted = !quoted;
      else throw new Error("Invalid CSV quote");
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(cell);
      cell = "";
      if (c !== ",") {
        if (c === "\r" && csv[i + 1] === "\n") i++;
        if (row.some(Boolean)) yield row;
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (cell || row.length) {
    row.push(cell);
    yield row;
  }
}
export function parseFirmsCsv(csv: string, source: string): Detection[] {
  const iterator = records(csv.replace(/^\uFEFF/, ""));
  const header = iterator.next().value;
  if (!header) throw new Error("Missing CSV schema");
  const indexes = Object.fromEntries(
    header.map((field, index) => [field.trim(), index]),
  );
  for (const key of [
    "latitude",
    "longitude",
    "acq_date",
    "acq_time",
    "satellite",
    "confidence",
    "frp",
  ])
    if (indexes[key] === undefined) throw new Error("Unexpected FIRMS schema");
  const output = new Map<string, Detection>();
  let count = 0;
  for (const row of iterator) {
    if (++count > 150000 || row.length !== header.length)
      throw new Error("CSV capacity or row mismatch");
    const get = (field: string) => row[indexes[field]].trim();
    const latitude = get("latitude"),
      longitude = get("longitude"),
      time = get("acq_time").padStart(4, "0"),
      date = get("acq_date");
    const lat = Number(latitude),
      lng = Number(longitude);
    if (
      !latitude ||
      !longitude ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      !/^\d{4}$/.test(time) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    )
      throw new Error("Invalid detection");
    const iso = `${date}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`;
    if (
      !Number.isFinite(Date.parse(iso)) ||
      new Date(iso).toISOString() !== iso
    )
      throw new Error("Invalid acquisition time");
    const rawFrp = get("frp"),
      frp = rawFrp ? Number(rawFrp) : null;
    if (frp !== null && !Number.isFinite(frp)) throw new Error("Invalid FRP");
    const satellite = get("satellite");
    const id = createHash("sha256")
      .update(`${source}|${lat}|${lng}|${iso}|${satellite}`)
      .digest("hex")
      .slice(0, 24);
    output.set(id, {
      id,
      lat,
      lng,
      observedAt: iso,
      satellite,
      confidence: get("confidence"),
      frp: frp !== null && frp >= 0 ? frp : null,
    });
  }
  return [...output.values()];
}
