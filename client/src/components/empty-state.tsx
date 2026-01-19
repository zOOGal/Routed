import { MapPin, Navigation, Compass, Route } from "lucide-react";

interface EmptyStateProps {
  type: "search" | "trips" | "error";
  title?: string;
  description?: string;
}

const configs = {
  search: {
    icon: Navigation,
    title: "Where are you heading?",
    description: "Enter your destination above and I'll find the best way to get you there with minimal stress.",
  },
  trips: {
    icon: Route,
    title: "No trips yet",
    description: "Your completed trips will appear here. Start a new trip to see your travel history.",
  },
  error: {
    icon: Compass,
    title: "Something went wrong",
    description: "I couldn't find a route for you. Please try again or choose different locations.",
  },
};

export function EmptyState({ type, title, description }: EmptyStateProps) {
  const config = configs[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
        <Icon className="h-10 w-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title || config.title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        {description || config.description}
      </p>
    </div>
  );
}
