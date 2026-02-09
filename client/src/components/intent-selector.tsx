import { Briefcase, Coffee, Calendar, Clock, Compass } from "lucide-react";
import type { TripIntent } from "@shared/schema";

interface IntentSelectorProps {
  value: TripIntent;
  onChange: (intent: TripIntent) => void;
}

const INTENTS: { id: TripIntent; label: string; icon: React.ReactNode }[] = [
  { id: "work", label: "Work", icon: <Briefcase className="h-4 w-4" /> },
  { id: "leisure", label: "Leisure", icon: <Coffee className="h-4 w-4" /> },
  { id: "appointment", label: "Appt", icon: <Calendar className="h-4 w-4" /> },
  { id: "time_sensitive", label: "Urgent", icon: <Clock className="h-4 w-4" /> },
  { id: "exploring", label: "Explore", icon: <Compass className="h-4 w-4" /> },
];

export function IntentSelector({ value, onChange }: IntentSelectorProps) {
  return (
    <div className="space-y-3">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Trip type
      </span>
      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Trip type">
        {INTENTS.map((intent) => (
          <button
            key={intent.id}
            type="button"
            role="radio"
            onClick={() => onChange(intent.id)}
            className={`
              flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium
              transition-all duration-200 min-h-[44px]
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2
              ${value === intent.id
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground border border-border/40"
              }
            `}
            aria-checked={value === intent.id}
          >
            {intent.icon}
            <span>{intent.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
