import { Header } from '@/components/shared/Header';
import { PageHeader } from '@/components/shared/PageHeader';
import type { ReactNode } from 'react';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        <PageHeader title="Settings" backPath="/" />
        {children}
      </main>
    </div>
  );
}
