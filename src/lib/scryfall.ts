export type ScryfallCard = {
  id: string;
  name: string;

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

const API = "https://api.scryfall.com";

export async function autocompleteNames(q: string): Promise<string[]> {
  const url = new URL(`${API}/cards/autocomplete`);
  url.searchParams.set("q", q);
  url.searchParams.set("include_extras", "false");
  url.searchParams.set("include_multilingual", "false");

  const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Autocomplete error: ${res.status}`);
  const data = await res.json();
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

export function getThumb(card: ScryfallCard): string | undefined {
  return card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
}

export function getImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}
