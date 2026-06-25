import React from 'react';
import { Loader2 } from 'lucide-react';

export default function LoadingScreen({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div className={`flex items-center justify-center w-full ${fullScreen ? 'min-h-[100dvh]' : 'h-full min-h-[300px]'} bg-bg-primary transition-all duration-300`}>
      <Loader2 className="w-10 h-10 animate-spin text-accent" />
    </div>
  );
}
