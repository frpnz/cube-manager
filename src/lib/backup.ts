import type { CubeEntry } from "./storage";

const BACKUP_PREFIX = "mtg_cube_backup_v1_";
const BACKUP_COUNT_KEY = "mtg_cube_backup_count_v1";

export type BackupInfo = {
  key: string;
  index: number;
  updated_at: number;
  size: number;
};

export function rotateBackups(entries: CubeEntry[], keep: number) {
  const k = Math.max(1, Math.min(keep, 10));
  // Determine next slot
  const rawCount = localStorage.getItem(BACKUP_COUNT_KEY);
  const count = rawCount ? Number(rawCount) : 0;
  const next = (Number.isFinite(count) ? count : 0) + 1;

  const slot = ((next - 1) % k) + 1; // 1..k
  const key = `${BACKUP_PREFIX}${slot}`;

  const payload = JSON.stringify({
    updated_at: Date.now(),
    entries
  });

  localStorage.setItem(key, payload);
  localStorage.setItem(BACKUP_COUNT_KEY, String(next));
}

export function listBackups(keep: number): BackupInfo[] {
  const k = Math.max(1, Math.min(keep, 10));
  const out: BackupInfo[] = [];
  for (let i = 1; i <= k; i++) {
    const key = `${BACKUP_PREFIX}${i}`;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { updated_at: number; entries: unknown };
      out.push({ key, index: i, updated_at: parsed.updated_at ?? 0, size: raw.length });
    } catch {
      // ignore corrupted backup
    }
  }
  return out.sort((a, b) => b.updated_at - a.updated_at);
}

export function restoreBackup(key: string): CubeEntry[] {
  const raw = localStorage.getItem(key);
  if (!raw) throw new Error("Backup non trovato");
  const parsed = JSON.parse(raw) as { updated_at: number; entries: CubeEntry[] };
  if (!Array.isArray(parsed.entries)) throw new Error("Backup non valido");
  return parsed.entries;
}
