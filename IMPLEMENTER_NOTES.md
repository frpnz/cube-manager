# Quick start (implementatore)

1) Crea repo GitHub, copia dentro questi file e pusha su `main`.
2) GitHub → Settings → Pages → Source: **GitHub Actions**.
3) Vai su Actions e verifica che il workflow "Deploy to GitHub Pages" finisca con successo.
4) Apri l'URL Pages.

Config rapida:
- `vite.config.ts` usa `base: "./"` quindi nessun cambio per il nome repo.
- Backup automatici: modifica `BACKUPS_TO_KEEP` e `BACKUP_EVERY_MS` in `src/App.tsx`.
