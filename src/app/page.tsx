import { getAvailableTables } from '@/app/actions/dashboardActions';
import DashboardClient from '@/components/DashboardClient';

export default async function Page() {
  const initialTables = await getAvailableTables().catch(() => []);

  return (
    <main>
      <DashboardClient initialTables={initialTables} />
    </main>
  );
}
