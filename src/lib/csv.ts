import type { CubeEntry } from "./storage";

function escCsv(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function cubeToCsv(entries: CubeEntry[]): string {
  const header = [
    "qty",
    "name",
    "set",
    "collector_number",
    "rarity",
    "color_identity",
    "cmc",
    "type_line",
    "scryfall_uri"
  ];

  const rows = entries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => [
      e.qty,
      e.name,
      e.set,
      e.collector_number,
      e.rarity,
      (e.color_identity ?? []).join(""),
      e.cmc ?? "",
      e.type_line,
      e.scryfall_uri
    ]);

  return [header, ...rows].map((r) => r.map(escCsv).join(",")).join("\n");
}

export function cubeToJson(entries: CubeEntry[]): string {
  return JSON.stringify({ version: 1, exported_at: new Date().toISOString(), entries }, null, 2);
}

export function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
