import type { CubeEntry } from "./storage";

type CubeJsonV1 = {
  version?: number;
  exported_at?: string;
  entries?: unknown;
};

function isCubeEntry(x: any): x is CubeEntry {
  return x
    && typeof x === "object"
    && typeof x.id === "string"
    && typeof x.name === "string"
    && typeof x.qty === "number"
    && typeof x.set === "string"
    && typeof x.collector_number === "string"
    && typeof x.rarity === "string"
    && typeof x.type_line === "string"
    && typeof x.scryfall_uri === "string";
}

export function parseCubeJson(text: string): CubeEntry[] {
  const raw = JSON.parse(text) as CubeJsonV1 | unknown;

  // Accept either { entries: [...] } (preferred) or a raw array of entries
  const entries =
    Array.isArray((raw as any)?.entries) ? (raw as any).entries :
    Array.isArray(raw) ? raw :
    null;

  if (!entries) throw new Error("File JSON non riconosciuto (manca 'entries').");

  const parsed: CubeEntry[] = [];
  for (const e of entries) {
    if (!isCubeEntry(e)) continue;
    const qty = Math.max(1, Math.min(99, Number((e as any).qty) || 1));
    parsed.push({ ...(e as any), qty });
  }
  if (parsed.length === 0) throw new Error("Nessuna entry valida trovata nel JSON.");
  return parsed;
}
