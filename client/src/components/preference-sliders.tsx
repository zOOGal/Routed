import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Leaf, Zap, Wallet, Sparkles } from "lucide-react";

interface PreferenceSlidersProps {
  calmVsFast: number;
  economyVsComfort: number;
  unfamiliarWithCity: boolean;
  onCalmVsFastChange: (value: number) => void;
  onEconomyVsComfortChange: (value: number) => void;
  onUnfamiliarChange: (value: boolean) => void;
}

export function PreferenceSliders({
  calmVsFast,
  economyVsComfort,
  unfamiliarWithCity,
  onCalmVsFastChange,
  onEconomyVsComfortChange,
  onUnfamiliarChange,
}: PreferenceSlidersProps) {
  return (
    <div className="space-y-5">
      {/* Calm vs Fast */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Leaf className="h-3.5 w-3.5" />
            calm
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            fast
            <Zap className="h-3.5 w-3.5" />
          </span>
        </div>
        <Slider
          value={[calmVsFast]}
          onValueChange={([value]) => onCalmVsFastChange(value)}
          max={100}
          step={1}
          className="w-full"
          data-testid="slider-calm-fast"
        />
      </div>

      {/* Economy vs Comfort */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" />
            budget
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            comfort
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>
        <Slider
          value={[economyVsComfort]}
          onValueChange={([value]) => onEconomyVsComfortChange(value)}
          max={100}
          step={1}
          className="w-full"
          data-testid="slider-economy-comfort"
        />
      </div>

      {/* City familiarity */}
      <div className="flex items-center gap-3 pt-1">
        <Checkbox
          id="unfamiliar-toggle"
          checked={unfamiliarWithCity}
          onCheckedChange={(checked) => onUnfamiliarChange(checked === true)}
          data-testid="checkbox-unfamiliar"
        />
        <Label 
          htmlFor="unfamiliar-toggle" 
          className="text-sm text-muted-foreground cursor-pointer"
        >
          I'm new to this city (simpler routes)
        </Label>
      </div>
    </div>
  );
}
