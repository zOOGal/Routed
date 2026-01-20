import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Leaf, Zap, Wallet, Sparkles } from "lucide-react";

interface PreferenceSlidersProps {
  calmVsFast: number; // 0 = calm, 100 = fast
  economyVsComfort: number; // 0 = economy, 100 = comfort
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
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Leaf className="h-4 w-4" />
            <span>Calm</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span>Fast</span>
            <Zap className="h-4 w-4" />
          </div>
        </div>
        <Slider
          value={[calmVsFast]}
          onValueChange={(v) => onCalmVsFastChange(v[0])}
          max={100}
          step={1}
          className="cursor-pointer"
          data-testid="slider-calm-fast"
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Wallet className="h-4 w-4" />
            <span>Economy</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span>Comfort</span>
            <Sparkles className="h-4 w-4" />
          </div>
        </div>
        <Slider
          value={[economyVsComfort]}
          onValueChange={(v) => onEconomyVsComfortChange(v[0])}
          max={100}
          step={1}
          className="cursor-pointer"
          data-testid="slider-economy-comfort"
        />
      </div>

      <div className="flex items-center gap-3 py-2">
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
          I'm unfamiliar with this city
        </Label>
      </div>
    </div>
  );
}
