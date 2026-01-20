interface EmptyStateProps {
  type: "search" | "trips" | "error";
  title?: string;
  description?: string;
}

const configs = {
  search: {
    title: "enter a destination",
    description: "share where you'd like to go, and I'll find a peaceful way to get you there.",
  },
  trips: {
    title: "no journeys yet",
    description: "your completed journeys will appear here, ready for reflection.",
  },
  error: {
    title: "a moment of pause",
    description: "I couldn't find a path this time. perhaps try a different destination?",
  },
};

export function EmptyState({ type, title, description }: EmptyStateProps) {
  const config = configs[type];

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {/* Subtle organic shape - Shizen */}
      <div 
        className="w-12 h-12 rounded-full border border-border/40 mb-8 opacity-40"
        style={{ borderRadius: '45% 55% 50% 50%' }}
      />
      <p className="text-sm text-muted-foreground/60 max-w-xs leading-relaxed">
        {description || config.description}
      </p>
    </div>
  );
}
