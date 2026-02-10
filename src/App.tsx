import React, { useEffect, useMemo, useRef, useState } from "react";
import { autocompleteNames, fetchByExactName, getThumb } from "./lib/scryfall";
import { cardToEntry, loadCube, loadMeta, saveCube, type CubeEntry } from "./lib/storage";
import { cubeToCsv, cubeToJson, downloadTextFile } from "./lib/csv";
import { debounce } from "./lib/debounce";
import { listBackups, restoreBackup, rotateBackups } from "./lib/backup";

const BACKUPS_TO_KEEP = 5;
const BACKUP_EVERY_MS = 45_000; // checkpoint at most every 45s (also on first change)

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

    // create periodic checkpoints (rotating backups)
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
      e.returnValue = ""; // required for some browsers
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

  async function addCardByName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setError(null);
    setInfo(null);
    try {
      const card = await fetchByExactName(trimmed);
      const thumb = getThumb(card);

      setCube((prev) => {
        // dedupe: same id OR same name (safety)
        const idx = prev.findIndex((x) => x.id === card.id || x.name === card.name);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
          return next;
        }
        return [...prev, cardToEntry(card, thumb)];
      });

      setQuery("");
      setSuggestions([]);
      setIsSuggestOpen(false);
    } catch (e: any) {
      setError(e?.message ?? "Errore caricamento carta");
    } finally {
      setIsLoading(false);
    }
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
        <span className="badge">GitHub Pages ready</span>
        <span className="badge">Scryfall API</span>
      </div>
      <p className="subtitle">
        Totale carte (qty): <b>{totalCount}</b> • Righe: <b>{cube.length}</b> • Ultimo salvataggio: <b>{fmtTime(meta?.updated_at)}</b>
      </p>

      <div className="two-col" style={{ marginTop: 14 }}>
        <div className="card" ref={clickAwayRef}>
          <div className="row">
            <div className="dropdown" style={{ flex: 1, minWidth: 280 }}>
              <input
                className="input"
                value={query}
                placeholder='Scrivi il nome carta… (es. "Lightning Bolt")'
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIsSuggestOpen(true);
                }}
                onFocus={() => setIsSuggestOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim().length > 0) addCardByName(query.trim());
                }}
              />
              {isSuggestOpen && suggestions.length > 0 && (
                <div className="suggest" role="listbox" aria-label="Suggerimenti carte">
                  {suggestions.slice(0, 12).map((s) => (
                    <button key={s} onClick={() => addCardByName(s)} title="Aggiungi al cubo">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button className="button" disabled={isLoading || query.trim().length === 0} onClick={() => addCardByName(query.trim())}>
              {isLoading ? "Carico…" : "Aggiungi"}
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
            <div className="small">Nessuna carta nel cubo. Inizia a cercare sopra 🙂</div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small muted">
                  Suggerimento: prima di cambiare dispositivo o browser, esporta un backup JSON.
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

                      <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
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
            <b>Come funziona il salvataggio:</b>
            <ul>
              <li>Ogni modifica viene salvata automaticamente in questo browser (localStorage).</li>
              <li>In più, l’app crea backup rotanti automatici (fino a {BACKUPS_TO_KEEP}).</li>
              <li>Per portare il cubo su un altro PC/telefono: usa <b>Export JSON</b>.</li>
            </ul>
          </div>

          <div className="footer">
            <span>Tip: evita modalità Incognito per non perdere dati alla chiusura.</span>
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
    </div>
  );
}
