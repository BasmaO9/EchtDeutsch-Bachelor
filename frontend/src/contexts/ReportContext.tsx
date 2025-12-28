import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface ReportContextType {
  evaluationId: string | undefined;
  setEvaluationId: (id: string | undefined) => void;
}

const ReportContext = createContext<ReportContextType | undefined>(undefined);

export function ReportProvider({ children }: { children: ReactNode }) {
  const [evaluationId, setEvaluationId] = useState<string | undefined>(undefined);

  return (
    <ReportContext.Provider value={{ evaluationId, setEvaluationId }}>
      {children}
    </ReportContext.Provider>
  );
}

export function useReportContext() {
  const context = useContext(ReportContext);
  if (context === undefined) {
    throw new Error('useReportContext must be used within a ReportProvider');
  }
  return context;
}

