import { Loader2, Brain, Sparkles, Route, MapPin } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

const loadingMessages = [
  { icon: Brain, text: "Analyzing stress factors..." },
  { icon: Route, text: "Evaluating route options..." },
  { icon: MapPin, text: "Checking city conditions..." },
  { icon: Sparkles, text: "Finding your best option..." },
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

  const currentMessage = loadingMessages[messageIndex];
  const Icon = currentMessage.icon;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
        </div>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-accent flex items-center justify-center"
        >
          <Sparkles className="h-5 w-5 text-accent-foreground" />
        </motion.div>
      </div>
      
      <AnimatePresence mode="wait">
        <motion.div
          key={messageIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex items-center gap-3 text-center"
        >
          <Icon className="h-5 w-5 text-primary" />
          <span className="text-muted-foreground">{message || currentMessage.text}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
