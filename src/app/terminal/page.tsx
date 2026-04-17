"use client";

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import TerminalViewer from '@/components/TerminalViewer';

function TerminalSoloContent() {
  const searchParams = useSearchParams();
  const serverId = searchParams.get('serverId');
  const logType = searchParams.get('logType');
  const sourceId = searchParams.get('sourceId');

  if (!serverId || !logType || !sourceId) {
    return (
      <div className="h-screen w-screen bg-black flex items-center justify-center text-zinc-500 font-mono text-sm">
        Invalid Terminal Parameters.
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0">
        <TerminalViewer 
          serverId={Number(serverId)}
          logType={logType}
          sourceId={sourceId}
          isActiveSlot={true}
        />
      </div>
    </div>
  );
}

export default function TerminalSoloPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-black flex items-center justify-center text-purple-500 animate-pulse">Initializing Detached Stream...</div>}>
      <TerminalSoloContent />
    </Suspense>
  );
}
