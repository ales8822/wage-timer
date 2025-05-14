import { Header } from '@/components/shared/Header';
import { PageHeader } from '@/components/shared/PageHeader';
import type { ReactNode } from 'react';
import { ClearHistoryButton } from './components/ClearHistoryButton';


export default function HistoryLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        <PageHeader title="Work History" backPath="/">
          <ClearHistoryButton />
        </PageHeader>
        {children}
      </main>
    </div>
  );
}
