import { cn } from "@/lib/utils";
import type { TravelMood } from "@shared/schema";
import { Smile, Zap, Moon, Compass, Coffee } from "lucide-react";

const MOODS: { id: TravelMood; label: string; description: string; Icon: typeof Smile }[] = [
  { id: "relaxed", label: "Relaxed", description: "No rush", Icon: Coffee },
  { id: "normal", label: "Normal", description: "Balanced", Icon: Smile },
  { id: "hurry", label: "In a Hurry", description: "Need speed", Icon: Zap },
  { id: "tired", label: "Tired", description: "Less walking", Icon: Moon },
  { id: "adventurous", label: "Adventurous", description: "Scenic route", Icon: Compass },
];

interface MoodSelectorProps {
  selectedMood: TravelMood;
  onMoodChange: (mood: TravelMood) => void;
}

export function MoodSelector({ selectedMood, onMoodChange }: MoodSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground">How are you feeling?</label>
      <div className="grid grid-cols-5 gap-2">
        {MOODS.map((mood) => (
          <button
            key={mood.id}
            type="button"
            onClick={() => onMoodChange(mood.id)}
            data-testid={`button-mood-${mood.id}`}
            className={cn(
              "flex flex-col items-center gap-1 p-3 rounded-lg border transition-all",
              selectedMood === mood.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover-elevate text-muted-foreground"
            )}
          >
            <mood.Icon className={cn(
              "h-5 w-5",
              selectedMood === mood.id ? "text-primary" : "text-muted-foreground"
            )} />
            <span className="text-xs font-medium">{mood.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
