export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  lang?: string;

  name: string;
  printed_name?: string;

  set: string;
  collector_number: string;
  rarity: string;
  type_line: string;
  mana_cost?: string;
  cmc?: number;
  color_identity?: string[];

  scryfall_uri: string;
  image_uris?: { small?: string; normal?: string };
  card_faces?: Array<{ image_uris?: { small?: string; normal?: string } }>;
};

type ScryfallList<T> = {
  object: "list";
  total_cards?: number;
  has_more?: boolean;
  data: T[];
};

const API = "https://api.scryfall.com";

async function getJson(url: string) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
  return res.json();
}

export async function autocompleteNames(q: string): Promise<string[]> {
  const url = new URL(`${API}/cards/autocomplete`);
  url.searchParams.set("q", q);
  url.searchParams.set("include_extras", "false");
  url.searchParams.set("include_multilingual", "false");

  const data = await getJson(url.toString());
  return (data?.data ?? []) as string[];
}

export async function fetchByExactName(name: string): Promise<ScryfallCard> {
  // Try exact first
  const exact = new URL(`${API}/cards/named`);
  exact.searchParams.set("exact", name);

  const res = await fetch(exact.toString(), { headers: { "Accept": "application/json" } });
  if (res.ok) return (await res.json()) as ScryfallCard;

  // Fallback fuzzy
  const fuzzy = new URL(`${API}/cards/named`);
  fuzzy.searchParams.set("fuzzy", name);
  const res2 = await fetch(fuzzy.toString(), { headers: { "Accept": "application/json" } });
  if (!res2.ok) throw new Error(`Card fetch error: ${res2.status}`);
  return (await res2.json()) as ScryfallCard;
}

export async function searchCards(q: string): Promise<ScryfallCard[]> {
  const url = new URL(`${API}/cards/search`);
  url.searchParams.set("q", q);
  // Keep results reasonably small for UX
  url.searchParams.set("unique", "prints");
  const data = (await getJson(url.toString())) as ScryfallList<ScryfallCard>;
  return (data?.data ?? []) as ScryfallCard[];
}

/**
 * Try to find IT-printed cards by (possibly Italian) name.
 * First uses exact-name search (!"..."), then falls back to non-exact ("...").
 */
export async function searchItalianByName(input: string): Promise<ScryfallCard[]> {
  const cleaned = input.replace(/"/g, '\"').trim();
  if (!cleaned) return [];

  // Exact printed name (best)
  const qExact = `lang:it !"${cleaned}"`;
  const exact = await searchCards(qExact).catch(() => []);
  if (exact.length > 0) return exact;

  // Non-exact (fallback)
  const qLoose = `lang:it "${cleaned}"`;
  const loose = await searchCards(qLoose).catch(() => []);
  return loose;
}

/** Map a card (via oracle_id) to an English printing (for canonical EN name). */
export async function fetchEnglishByOracleId(oracleId: string): Promise<ScryfallCard | null> {
  const cleaned = oracleId.trim();
  if (!cleaned) return null;
  const q = `oracleid:${cleaned} lang:en`;
  const res = await searchCards(q).catch(() => []);
  return res[0] ?? null;
}

export function displayName(card: ScryfallCard): string {
  return card.printed_name ?? card.name;
}

export function getThumb(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

export function getImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}
