# MTG Cube Builder (GitHub Pages ready)

App web **static** per creare un cubo MTG usando **Scryfall API** (autocomplete + dettagli carta) con salvataggio locale e backup automatici.

## Caratteristiche
- Autocomplete nomi carte (Scryfall, **inglese**)
- Helper ricerca IT→EN: se inserisci un nome italiano, prova a mappare alla carta inglese tramite stampe IT (quando disponibili)
- Anteprima carta con immagine + conferma aggiunta (quantità default 1)
- Aggiunta carte al cubo con quantità (dedup automatico)
- Visualizzazione lista con thumbnail
- **Autosave** su `localStorage`
- **Backup rotanti automatici** (default: 5) su `localStorage`
- Export **CSV** (lista finale) + Export **JSON** (backup completo)
- Import **JSON** (sostituisci o unisci)
- Ripristino da backup locale

## Requisiti
- Node.js 18+ (consigliato 20+)
- GitHub repository + GitHub Pages (via GitHub Actions)

## Setup locale
```bash
npm install
npm run dev
```
Apri l'URL mostrato in console.

## Build
```bash
npm run build
npm run preview
```

## Deploy su GitHub Pages (consigliato)
1. Crea un repo GitHub e copia dentro questo progetto.
2. Assicurati che il branch principale sia `main`.
3. Pusha su GitHub.
4. Vai su **Settings → Pages** e imposta **Source = GitHub Actions**.
5. Ogni push su `main` effettua build e deploy.

> Nota: `vite.config.ts` usa `base: "./"` così non devi conoscere in anticipo il nome del repository.

## Architettura dati
- Cube entries salvate in `localStorage` key: `mtg_cube_v1`
- Meta (timestamp ultimo salvataggio): `mtg_cube_meta_v1`
- Backup rotanti:
  - `mtg_cube_backup_v1_1` … `mtg_cube_backup_v1_5`
  - contatore slot: `mtg_cube_backup_count_v1`

### Modello `CubeEntry`
Vedi `src/lib/storage.ts`. Le colonne esportate nel CSV sono in `src/lib/csv.ts`.

## Backup automatici: come funziona
- Ogni modifica salva subito lo stato corrente (autosave).
- Inoltre, viene creato un “checkpoint” backup rotante almeno ogni ~45 secondi (configurabile).
- L’utente può ripristinare uno dei backup disponibili tramite UI.

Parametri configurabili:
- `BACKUPS_TO_KEEP` (default 5) in `src/App.tsx`
- `BACKUP_EVERY_MS` (default 45000) in `src/App.tsx`

## Import (opzionale)
Questo pacchetto include export CSV/JSON e ripristino da backup locale.
Se vuoi import JSON/CSV:
- aggiungi un input file e parse in `setCube()`
- per JSON, è sufficiente leggere `{ version, entries }`

## Limitazioni (importanti)
- GitHub Pages è **statico**: non esiste un DB condiviso tra utenti.
- Ogni utente ha il proprio cubo nel proprio browser/dispositivo.
- Incognito / cancellazione dati sito → perdita dei dati locali.
- Per trasferire su altro device: usare **Export JSON**.

## Scryfall
Questa app usa endpoint pubblici di Scryfall:
- `GET /cards/autocomplete?q=...`
- `GET /cards/named?exact=...` (fallback `fuzzy`)

## Licenza
MIT.
