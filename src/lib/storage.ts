import type { ScryfallCard } from "./scryfall";

export type CubeEntry = {
  id: string;
  name: string;
  qty: number;

  set: string;
  collector_number: string;
  rarity: string;
  type_line: string;
  mana_cost?: string;
  cmc?: number;
  color_identity?: string[];

  scryfall_uri: string;
  thumb?: string;
};

const KEY = "mtg_cube_v1";
const META_KEY = "mtg_cube_meta_v1";

export type CubeMeta = {
  updated_at: number; // epoch ms
  version: 1;
};

export function loadCube(): CubeEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CubeEntry[];
  } catch {
    return [];
  }
}

export function saveCube(items: CubeEntry[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  const meta: CubeMeta = { updated_at: Date.now(), version: 1 };
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function loadMeta(): CubeMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CubeMeta;
  } catch {
    return null;
  }
}

export function cardToEntry(card: ScryfallCard, thumb?: string): CubeEntry {
  return {
    id: card.id,
    name: card.name,
    qty: 1,
    set: card.set,
    collector_number: card.collector_number,
    rarity: card.rarity,
    type_line: card.type_line,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    color_identity: card.color_identity,
    scryfall_uri: card.scryfall_uri,
    thumb
  };
}
