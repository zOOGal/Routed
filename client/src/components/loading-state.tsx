import { useState, useEffect } from "react";

const loadingMessages = [
  "considering the way...",
  "sensing the city's rhythm...",
  "finding calm paths...",
  "preparing your journey...",
];

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message }: LoadingStateProps) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const dotsInterval = setInterval(() => {
      setDots((prev) => (prev % 3) + 1);
    }, 600);
    return () => clearInterval(dotsInterval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-20 px-6">
      {/* Organic breathing circle - Seijaku */}
      <div className="relative mb-10">
        <div className="w-16 h-16 rounded-full border border-border/50 animate-breathe" />
        <div 
          className="absolute inset-2 rounded-full bg-primary/10 animate-breathe"
          style={{ animationDelay: '0.5s' }}
        />
        <div 
          className="absolute inset-4 rounded-full bg-primary/20 animate-breathe"
          style={{ animationDelay: '1s' }}
        />
      </div>
      
      {/* Gentle message transition */}
      <p className="text-sm text-muted-foreground/70 tracking-wide transition-opacity duration-500">
        {message || loadingMessages[messageIndex]}
      </p>
    </div>
  );
}
