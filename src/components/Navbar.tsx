'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, History } from 'lucide-react';

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/30">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-foreground transition-colors hover:text-primary"
        >
          <BarChart3 className="h-6 w-6" />
          <span>Looker Ads</span>
        </Link>
        <div className="flex gap-1">
          <Link
            href="/"
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              pathname === '/'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/historial"
            className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              pathname === '/historial'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <History className="h-4 w-4" />
            Historial
          </Link>
        </div>
      </div>
    </nav>
  );
}
