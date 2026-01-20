import { MapPin, Route, AlertCircle } from "lucide-react";

interface EmptyStateProps {
  type: "search" | "trips" | "error";
  title?: string;
  description?: string;
}

const configs = {
  search: {
    icon: MapPin,
    title: "ready to help",
    description: "enter your destination above and I'll find the best route for you.",
  },
  trips: {
    icon: Route,
    title: "no trips yet",
    description: "your completed journeys will appear here.",
  },
  error: {
    icon: AlertCircle,
    title: "something went wrong",
    description: "I couldn't find a route. please try again or try a different destination.",
  },
};

export function EmptyState({ type, title, description }: EmptyStateProps) {
  const config = configs[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-medium mb-1">{title || config.title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs">
        {description || config.description}
      </p>
    </div>
  );
}
