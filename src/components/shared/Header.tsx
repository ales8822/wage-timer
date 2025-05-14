"use client";

import Link from 'next/link';
import { Moon, Sun, Settings as SettingsIcon, ListChecks } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function Header() {
  const { setTheme, theme } = useTheme();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center space-x-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7 text-primary">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l1.41-1.41L12 16.17l4.09-4.08L17.5 13.5 12 19 6.5 13.5zM12 5c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
          <span className="font-bold text-xl sm:text-2xl">Wage Wise</span>
        </Link>
        <nav className="flex items-center space-x-2 sm:space-x-3">
          <Button variant="ghost" size="icon" aria-label="Work History" onClick={() => router.push('/history')}>
            <ListChecks className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => router.push('/settings')}>
            <SettingsIcon className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </nav>
      </div>
    </header>
  );
}
