import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  autocompleteNames,
  fetchByExactName,
  fetchEnglishByOracleId,
  getImage,
  getThumb,
  searchItalianByName,
  displayName,
  type ScryfallCard
} from "./lib/scryfall";
import { cardToEntry, loadCube, loadMeta, saveCube, type CubeEntry } from "./lib/storage";
import { cubeToCsv, cubeToJson, downloadTextFile } from "./lib/csv";
import { debounce } from "./lib/debounce";
import { listBackups, restoreBackup, rotateBackups } from "./lib/backup";
import { parseCubeJson } from "./lib/importer";

const BACKUPS_TO_KEEP = 5;
const BACKUP_EVERY_MS = 45_000; // checkpoint at most every 45s (also on first change)

type Pending = {
  input: string;
  card: ScryfallCard; // EN card used for the cube
  thumb?: string;
  image?: string;
  matchedViaItalian?: boolean;
  italianName?: string;
};

type Candidate = {
  itCard: ScryfallCard;
  itName: string;
  hint: string;
};

function fmtTime(ts?: number) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

export default function App() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [cube, setCube] = useState<CubeEntry[]>(() => loadCube());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Preview/confirm step
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingQty, setPendingQty] = useState<number>(1);

  // If Italian input matches multiple cards, show candidates first
  const [candidates, setCandidates] = useState<{ input: string; list: Candidate[] } | null>(null);

  const meta = loadMeta();
  const totalCount = useMemo(() => cube.reduce((acc, e) => acc + e.qty, 0), [cube]);

  const cacheRef = useRef(new Map<string, string[]>()); // q -> suggestions
  const clickAwayRef = useRef<HTMLDivElement | null>(null);
  const lastCheckpointRef = useRef<number>(0);
  const dirtyRef = useRef<boolean>(false);

  // Persist on any change
  useEffect(() => {
    saveCube(cube);
    dirtyRef.current = true;

    const now = Date.now();
    if (now - lastCheckpointRef.current > BACKUP_EVERY_MS) {
      rotateBackups(cube, BACKUPS_TO_KEEP);
      lastCheckpointRef.current = now;
      dirtyRef.current = false;
    }
  }, [cube]);

  // Close warning if user changed very recently
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // click-away closes suggestions
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!clickAwayRef.current) return;
      if (!clickAwayRef.current.contains(e.target as Node)) setIsSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Escape closes modal(s)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending(null);
        setCandidates(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const runSuggest = useMemo(
    () =>
      debounce(async (q: string) => {
        setError(null);
        const trimmed = q.trim();
        if (trimmed.length < 2) {
          setSuggestions([]);
          return;
        }
        const key = trimmed.toLowerCase();
        const cached = cacheRef.current.get(key);
        if (cached) {
          setSuggestions(cached);
          return;
        }
        try {
          const res = await autocompleteNames(trimmed);
          cacheRef.current.set(key, res);
          setSuggestions(res);
        } catch (e: any) {
          setError(e?.message ?? "Errore autocomplete");
          setSuggestions([]);
        }
      }, 250),
    []
  );

  useEffect(() => {
    runSuggest(query);
  }, [query, runSuggest]);

  async function previewCardByName(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setError(null);
    setInfo(null);
    setPending(null);
    setCandidates(null);

    // 1) Try normal EN-first (works for English names and many partials)
    try {
      const card = await fetchByExactName(trimmed);
      const thumb = getThumb(card);
      const image = getImage(card);

      setPending({
        input: trimmed,
        card,
        thumb,
        image,
        matchedViaItalian: false
      });
      setPendingQty(1);
      setQuery("");
      setSuggestions([]);
      setIsSuggestOpen(false);
      return;
    } catch (e: any) {
      // fallback below
    }

    // 2) Fallback: user typed Italian name -> try to find IT printing(s), then map to EN via oracle_id
    try {
      const itMatches = await searchItalianByName(trimmed);
      if (itMatches.length === 0) {
        setError("Nessun risultato. Suggerimento: prova il nome inglese (autocomplete) oppure controlla la spelling.");
        return;
      }

      // Build candidate list (avoid duplicates by oracle_id when possible)
      const seen = new Set<string>();
      const list: Candidate[] = [];
      for (const c of itMatches) {
        const key = (c.oracle_id ?? c.id) + "|" + (c.printed_name ?? c.name);
        if (seen.has(key)) continue;
        seen.add(key);
        const itName = displayName(c);
        const hint = `${c.set.toUpperCase()} #${c.collector_number} • ${c.rarity}`;
        list.push({ itCard: c, itName, hint });
        if (list.length >= 8) break;
      }

      // If multiple candidates, ask user to pick
      if (list.length > 1) {
        setCandidates({ input: trimmed, list });
        setQuery("");
        setSuggestions([]);
        setIsSuggestOpen(false);
        return;
      }

      // Single candidate -> map to EN automatically
      const only = list[0].itCard;
      const oracleId = only.oracle_id;
      if (!oracleId) {
        setError("Trovata una stampa IT, ma manca oracle_id per mappare in inglese.");
        return;
      }
      const en = await fetchEnglishByOracleId(oracleId);
      if (!en) {
        setError("Trovata stampa IT ma non riesco a trovare la corrispondente EN.");
        return;
      }

      setPending({
        input: trimmed,
        card: en,
        thumb: getThumb(en),
        image: getImage(en),
        matchedViaItalian: true,
        italianName: displayName(only)
      });
      setPendingQty(1);
      setQuery("");
      setSuggestions([]);
      setIsSuggestOpen(false);
    } catch (e: any) {
      setError(e?.message ?? "Errore ricerca IT→EN");
    } finally {
      setIsLoading(false);
    }
  }

  async function chooseCandidate(c: Candidate) {
    setIsLoading(true);
    setError(null);
    try {
      const oracleId = c.itCard.oracle_id;
      if (!oracleId) throw new Error("Candidato senza oracle_id (impossibile mappare).");
      const en = await fetchEnglishByOracleId(oracleId);
      if (!en) throw new Error("Non riesco a trovare la corrispondente EN.");

      setCandidates(null);
      setPending({
        input: candidates?.input ?? "",
        card: en,
        thumb: getThumb(en),
        image: getImage(en),
        matchedViaItalian: true,
        italianName: c.itName
      });
      setPendingQty(1);
    } catch (e: any) {
      setError(e?.message ?? "Errore selezione candidato");
    } finally {
      setIsLoading(false);
    }
  }

  function confirmAddPending() {
    if (!pending) return;
    const qty = Math.max(1, Math.min(99, Number(pendingQty) || 1));

    const { card, thumb } = pending;

    setCube((prev) => {
      const idx = prev.findIndex((x) => x.id === card.id || x.name === card.name);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], qty: next[idx].qty + qty };
        return next;
      }
      const entry = cardToEntry(card, thumb);
      entry.qty = qty; // override default
      return [...prev, entry];
    });

    setPending(null);
    setInfo("Carta aggiunta al cubo.");
  }

  function removeEntry(id: string) {
    setCube((prev) => prev.filter((x) => x.id !== id));
  }

  function setQty(id: string, qty: number) {
    let q = qty;
    if (!Number.isFinite(q) || q < 1) q = 1;
    if (q > 99) q = 99;
    setCube((prev) => prev.map((x) => (x.id === id ? { ...x, qty: q } : x)));
  }

  function exportCsv() {
    const csv = cubeToCsv(cube);
    downloadTextFile("cube.csv", csv, "text/csv;charset=utf-8");
    setInfo("CSV esportato.");
  }

  function exportJson() {
    const j = cubeToJson(cube);
    downloadTextFile("cube.json", j, "application/json;charset=utf-8");
    setInfo("JSON esportato (backup completo).");
  }

async function importJsonFile(file: File) {
  try {
    setError(null);
    setInfo(null);
    const text = await file.text();
    const entries = parseCubeJson(text);

    const msg =
      `Import: trovate ${entries.length} righe.\n\n` +
      `OK = Sostituisci il cubo corrente\n` +
      `Annulla = Unisci (somma qty dove possibile)`;

    const replace = confirm(msg);

    setCube((prev) => {
      if (replace) return entries;

      const map = new Map<string, CubeEntry>();
      for (const p of prev) map.set(p.id || p.name, { ...p });

      for (const e of entries) {
        const key = e.id || e.name;
        const existing = map.get(key);
        if (existing) {
          map.set(key, { ...existing, qty: Math.min(99, existing.qty + e.qty) });
        } else {
          map.set(key, { ...e });
        }
      }
      return Array.from(map.values());
    });

    setInfo("Import completato.");
  } catch (e: any) {
    setError(e?.message ?? "Errore import JSON");
  }
}

function onPickImportFile(ev: React.ChangeEvent<HTMLInputElement>) {
  const f = ev.target.files?.[0];
  if (!f) return;
  if (!f.name.toLowerCase().endsWith(".json")) {
    setError("Seleziona un file .json");
    ev.target.value = "";
    return;
  }
  importJsonFile(f);
  ev.target.value = "";
}

  function clearCube() {
    if (!confirm("Sicuro di voler svuotare il cubo?")) return;
    setCube([]);
    setQuery("");
    setSuggestions([]);
    setError(null);
    setIsSuggestOpen(false);
    setInfo("Cubo svuotato.");
  }

  function openRestore() {
    try {
      const backups = listBackups(BACKUPS_TO_KEEP);
      if (backups.length === 0) {
        alert("Nessun backup disponibile in questo browser.");
        return;
      }
      const options = backups
        .map((b, i) => `${i + 1}) Backup #${b.index} — ${fmtTime(b.updated_at)} (${b.size} bytes)`)
        .join("\n");

      const choice = prompt(
        `Scegli un backup da ripristinare digitando il numero:\n\n${options}\n\n(Annulla per uscire)`
      );
      if (!choice) return;
      const n = Number(choice);
      if (!Number.isFinite(n) || n < 1 || n > backups.length) {
        alert("Scelta non valida.");
        return;
      }
      const selected = backups[n - 1];
      if (!confirm(`Ripristinare: Backup #${selected.index} — ${fmtTime(selected.updated_at)} ?`)) return;

      const restored = restoreBackup(selected.key);
      setCube(restored);
      setInfo("Backup ripristinato.");
    } catch (e: any) {
      alert(e?.message ?? "Errore ripristino backup");
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1 className="title">MTG Cube Builder</h1>
        <span className="badge">Desktop-first</span>
        <span className="badge">Scryfall API</span>
      </div>
      <p className="subtitle">
        Totale carte (qty): <b>{totalCount}</b> • Righe: <b>{cube.length}</b> • Ultimo salvataggio: <b>{fmtTime(meta?.updated_at)}</b>
      </p>

      <div className="two-col" style={{ marginTop: 14 }}>
        <div className="card" ref={clickAwayRef}>
          <div className="row">
            <div className="dropdown" style={{ flex: 1, minWidth: 360 }}>
              <input
                className="input"
                value={query}
                placeholder='Cerca per nome (autocomplete EN). Se conosci l’italiano, scrivilo e premi Invio: proverò IT → EN.'
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIsSuggestOpen(true);
                }}
                onFocus={() => setIsSuggestOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim().length > 0) previewCardByName(query.trim());
                }}
              />
              {isSuggestOpen && suggestions.length > 0 && (
                <div className="suggest" role="listbox" aria-label="Suggerimenti carte">
                  {suggestions.slice(0, 12).map((s) => (
                    <button key={s} onClick={() => previewCardByName(s)} title="Mostra anteprima">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="button" disabled={isLoading || query.trim().length === 0} onClick={() => previewCardByName(query.trim())}>
              {isLoading ? "Carico…" : "Anteprima"}
            </button>
          </div>

          {error && (
            <div className="banner" style={{ borderColor: "#5b2630", background: "rgba(59,11,20,0.35)" }}>
              <span className="badge">Errore</span> <span className="small">{error}</span>
            </div>
          )}
          {info && (
            <div className="banner">
              <span className="badge">Info</span> <span className="small">{info}</span>
            </div>
          )}

          <hr />

          {cube.length === 0 ? (
            <div className="small">Nessuna carta nel cubo. Cerca → Anteprima → Aggiungi 🙂</div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small muted">
                  Tip: per spostare il cubo su un altro PC/browser, usa Export JSON.
                </div>
              </div>

              <div className="grid">
                {cube
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((e) => (
                    <div key={e.id} className="card item">
                      <div className="thumb" title={e.name}>
                        {e.thumb ? <img src={e.thumb} alt={e.name} loading="lazy" /> : <span className="small">no img</span>}
                      </div>

                      <div>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                          <a href={e.scryfall_uri} target="_blank" rel="noreferrer">
                            <b>{e.name}</b>
                          </a>
                          <span className="badge">{e.set.toUpperCase()} #{e.collector_number}</span>
                          <span className="badge">{e.rarity}</span>
                        </div>
                        <div className="small" style={{ marginTop: 6 }}>
                          {e.type_line}
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
                        <input
                          className="input qty"
                          type="number"
                          min={1}
                          max={99}
                          value={e.qty}
                          onChange={(ev) => setQty(e.id, Number(ev.target.value))}
                          title="Quantità"
                        />
                        <button className="button danger" onClick={() => removeEntry(e.id)}>
                          Rimuovi
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Backup & Export</h2>
          <div className="row">
            <button className="button" disabled={cube.length === 0} onClick={exportCsv}>
              Export CSV
            </button>
            <button className="button secondary" disabled={cube.length === 0} onClick={exportJson}>
              Export JSON (backup)
            </button>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="button secondary" onClick={openRestore}>
              Ripristina da backup locale
            </button>
            <button className="button danger" disabled={cube.length === 0} onClick={clearCube}>
              Svuota cubo
            </button>
          </div>

          <hr />

          <div className="small">
            <b>Multibrowser:</b>
            <ul>
              <li>Ogni browser ha i propri dati locali.</li>
              <li>Per usare il cubo su un altro browser/PC: <b>Export JSON</b>, poi su quell'altro browser fai <b>Import JSON</b>.</li>
            </ul>
          </div>

          <div className="footer">
            <span>Tip: evita Incognito per non perdere dati alla chiusura.</span>
          </div>
        </div>
      </div>

      <div className="footer">
        <span>Dati carte: Scryfall</span>
        <span>•</span>
        <a href="./USER_GUIDE.html" target="_blank" rel="noreferrer">Guida utente</a>
        <span>•</span>
        <a href="./README.html" target="_blank" rel="noreferrer">Doc implementatore</a>
      </div>

      {/* Candidate modal (Italian ambiguity) */}
      {candidates && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Seleziona carta corrispondente" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setCandidates(null);
        }}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 16 }}><b>Ho trovato più risultati in italiano</b></div>
                <div className="small muted">Scegli quello giusto per mappare al nome inglese.</div>
              </div>
              <button className="button secondary" onClick={() => setCandidates(null)}>
                Chiudi
              </button>
            </div>

            <div className="modalBody" style={{ gridTemplateColumns: "1fr" }}>
              <div className="card" style={{ margin: 0 }}>
                <div className="small muted">Input: <b>{candidates.input}</b></div>
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {candidates.list.map((c, idx) => (
                    <button
                      key={idx}
                      className="button secondary"
                      style={{ textAlign: "left", width: "100%" }}
                      onClick={() => chooseCandidate(c)}
                      disabled={isLoading}
                      title="Seleziona"
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <b>{c.itName}</b>
                        <span className="badge">{c.hint}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="small muted" style={{ marginTop: 12 }}>
                  Nota: la ricerca IT funziona solo se esiste una stampa in italiano su Scryfall.
                </div>
              </div>
            </div>

            <div className="modalActions">
              <button className="button secondary" onClick={() => setCandidates(null)}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {pending && (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Conferma aggiunta carta" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setPending(null);
        }}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 16 }}><b>{pending.card.name}</b></div>
                <div className="small muted">{pending.card.type_line}</div>
              </div>
              <button className="button secondary" onClick={() => setPending(null)} aria-label="Chiudi anteprima">
                Chiudi
              </button>
            </div>

            <div className="modalBody">
              <div className="previewImg">
                {pending.image ? (
                  <img src={pending.image} alt={pending.card.name} />
                ) : (
                  <div style={{ padding: 14 }} className="small">Immagine non disponibile</div>
                )}
              </div>

              <div className="card" style={{ margin: 0 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="badge">{pending.card.set.toUpperCase()} #{pending.card.collector_number}</span>
                  <span className="badge">{pending.card.rarity}</span>
                </div>

                {pending.matchedViaItalian && (
                  <div className="banner" style={{ marginTop: 12 }}>
                    <span className="small">
                      IT → EN: <b>{pending.italianName ?? pending.input}</b> → <b>{pending.card.name}</b>
                    </span>
                  </div>
                )}

                <div style={{ marginTop: 10 }} className="small">
                  <b>Conferma aggiunta</b><br />
                  Imposta la quantità (default 1) e premi “Aggiungi al cubo”.
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <label className="small" style={{ minWidth: 110 }}>Quantità</label>
                  <input
                    className="input qty"
                    type="number"
                    min={1}
                    max={99}
                    value={pendingQty}
                    onChange={(e) => setPendingQty(Number(e.target.value))}
                  />
                  <a className="small" href={pending.card.scryfall_uri} target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>
                    Apri su Scryfall
                  </a>
                </div>
              </div>
            </div>

            <div className="modalActions">
              <button className="button secondary" onClick={() => setPending(null)}>
                Annulla
              </button>
              <button className="button" onClick={confirmAddPending}>
                Aggiungi al cubo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
