"use client";

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PageHeaderProps {
  title: string;
  showBackButton?: boolean;
  backPath?: string;
  children?: React.ReactNode; // For additional actions like delete icon
}

export function PageHeader({ title, showBackButton = true, backPath = "..", children }: PageHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between mb-6 pb-4 border-b">
      <div className="flex items-center gap-4">
        {showBackButton && (
          <Button variant="outline" size="icon" onClick={() => router.push(backPath)}>
            <ArrowLeft className="h-5 w-5" />
            <span className="sr-only">Go back</span>
          </Button>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
      </div>
      {children && <div>{children}</div>}
    </div>
  );
}
