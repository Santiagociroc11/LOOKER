import { Suspense } from 'react';
import { getAvailableTables } from '@/app/actions/dashboardActions';
import DashboardClient from '@/components/DashboardClient';

export default async function Page() {
  const initialTables = await getAvailableTables().catch(() => []);

  return (
    <main>
      <Suspense fallback={<div className="p-8 text-muted-foreground">Cargando...</div>}>
        <DashboardClient initialTables={initialTables} />
      </Suspense>
    </main>
  );
}
