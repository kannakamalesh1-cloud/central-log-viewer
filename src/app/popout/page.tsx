"use client";

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import TerminalViewer from '../../components/TerminalViewer';

function PopoutTerminal() {
  const searchParams = useSearchParams();
  const serverId = searchParams.get('serverId');
  const logType = searchParams.get('logType');
  const sourceId = searchParams.get('sourceId');

  if (!serverId || !logType || !sourceId) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400 font-mono">
        INVALID_PARAMETERS: MISSING_STREAM_CONFIG
      </div>
    );
  }

  return (
    <div className="h-screen w-screen p-2 bg-slate-50">
      <TerminalViewer 
        serverId={parseInt(serverId)} 
        logType={logType} 
        sourceId={sourceId} 
        isActiveSlot={true} 
      />
    </div>
  );
}

export default function PopoutPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-slate-900 text-sky-500 font-mono animate-pulse">
        LOADING_STREAM...
      </div>
    }>
      <PopoutTerminal />
    </Suspense>
  );
}
