"use client";

import type { ReactNode } from 'react';
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Shift } from '@/types';
import { getFromLocalStorage, setToLocalStorage } from '@/lib/localStorage';

const WORK_HISTORY_STORAGE_KEY = 'wageWiseWorkHistory';

interface WorkHistoryContextType {
  workHistory: Shift[];
  addShift: (shift: Shift) => void;
  updateShift: (updatedShift: Shift) => void;
  deleteShift: (id: string) => void;
  clearHistory: () => void;
  isLoading: boolean;
}

const WorkHistoryContext = createContext<WorkHistoryContextType | undefined>(undefined);

export const WorkHistoryProvider = ({ children }: { children: ReactNode }) => {
  const [workHistory, setWorkHistory] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedHistory = getFromLocalStorage<Shift[]>(WORK_HISTORY_STORAGE_KEY, []);
    setWorkHistory(storedHistory);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!isLoading) {
      setToLocalStorage(WORK_HISTORY_STORAGE_KEY, workHistory);
    }
  }, [workHistory, isLoading]);

  const addShift = (shift: Shift) => {
    setWorkHistory(prev => [shift, ...prev]); // Add new shifts to the beginning
  };

  const updateShift = (updatedShift: Shift) => {
    setWorkHistory(prev => prev.map(s => s.id === updatedShift.id ? updatedShift : s));
  };

  const deleteShift = (id: string) => {
    setWorkHistory(prev => prev.filter(s => s.id !== id));
  };

  const clearHistory = () => {
    setWorkHistory([]);
  }

  return (
    <WorkHistoryContext.Provider value={{ workHistory, addShift, updateShift, deleteShift, clearHistory, isLoading }}>
      {children}
    </WorkHistoryContext.Provider>
  );
};

export const useWorkHistory = (): WorkHistoryContextType => {
  const context = useContext(WorkHistoryContext);
  if (context === undefined) {
    throw new Error('useWorkHistory must be used within a WorkHistoryProvider');
  }
  return context;
};
