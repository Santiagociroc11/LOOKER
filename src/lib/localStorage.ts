import LZString from 'lz-string';

const STORAGE_KEY = 'looker_reports';
const MAX_REPORTS = 15;

export interface SavedReport {
  id: string;
  timestamp: number;
  label: string;
  data: unknown;
}

function decompressReports(raw: string): SavedReport[] {
  if (!raw) return [];
  if (raw.startsWith('{') || raw.startsWith('[')) {
    return JSON.parse(raw) as SavedReport[];
  }
  const decompressed = LZString.decompress(raw);
  if (!decompressed) return [];
  return JSON.parse(decompressed) as SavedReport[];
}

function compressReports(reports: SavedReport[]): string {
  const json = JSON.stringify(reports);
  return LZString.compress(json);
}

export function getSavedReports(): SavedReport[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = decompressReports(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReport(data: unknown): string {
  const id = `report_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const label = new Date().toLocaleString('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const report: SavedReport = { id, timestamp: Date.now(), label, data };
  const reports = getSavedReports();
  reports.unshift(report);
  const trimmed = reports.slice(0, MAX_REPORTS);
  const compressed = compressReports(trimmed);
  localStorage.setItem(STORAGE_KEY, compressed);
  return id;
}

export function getReportById(id: string): SavedReport | null {
  const reports = getSavedReports();
  return reports.find((r) => r.id === id) ?? null;
}

export function deleteReport(id: string): void {
  const reports = getSavedReports().filter((r) => r.id !== id);
  const compressed = compressReports(reports);
  localStorage.setItem(STORAGE_KEY, compressed);
}
