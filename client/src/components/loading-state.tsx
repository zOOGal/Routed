import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

const loadingMessages = [
  "analyzing routes...",
  "checking conditions...",
  "finding calm options...",
  "preparing recommendation...",
];

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message }: LoadingStateProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="relative mb-6">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-primary animate-spin" />
        </div>
      </div>
      
      <p className="text-sm text-muted-foreground">
        {message || loadingMessages[messageIndex]}
      </p>
    </div>
  );
}
