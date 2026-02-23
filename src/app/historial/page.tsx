'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSavedReports, deleteReport, type SavedReport } from '@/lib/localStorage';
import { Trash2, BarChart3 } from 'lucide-react';

export default function HistorialPage() {
  const [reports, setReports] = useState<SavedReport[]>([]);

  useEffect(() => {
    setReports(getSavedReports());
  }, []);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    deleteReport(id);
    setReports(getSavedReports());
  };

  if (reports.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="mb-6 text-2xl font-bold text-foreground">Reportes guardados</h1>
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <BarChart3 className="mx-auto mb-4 h-16 w-16 text-muted-foreground/50" />
          <p className="mb-2 text-lg font-medium text-foreground">No hay reportes guardados</p>
          <p className="mb-6 text-muted-foreground">
            Procesa datos en el Dashboard y se guardarán automáticamente aquí.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ir al Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-foreground">Reportes guardados</h1>
      <p className="mb-6 text-muted-foreground">
        Haz clic en un reporte para cargarlo en el Dashboard.
      </p>
      <ul className="space-y-2">
        {reports.map((report) => (
          <li key={report.id}>
            <Link
              href={`/?load=${report.id}`}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 hover:bg-card/80"
            >
              <span className="font-medium text-foreground">{report.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(report.timestamp).toLocaleDateString('es-ES')}
                </span>
                <button
                  onClick={(e) => handleDelete(e, report.id)}
                  className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
