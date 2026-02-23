const STORAGE_KEY = 'looker_reports';

export interface SavedReport {
  id: string;
  timestamp: number;
  label: string;
  data: unknown;
}

export function getSavedReports(): SavedReport[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
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
  // Mantener solo los últimos 50 reportes
  const trimmed = reports.slice(0, 50);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return id;
}

export function getReportById(id: string): SavedReport | null {
  const reports = getSavedReports();
  return reports.find((r) => r.id === id) ?? null;
}

export function deleteReport(id: string): void {
  const reports = getSavedReports().filter((r) => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}
