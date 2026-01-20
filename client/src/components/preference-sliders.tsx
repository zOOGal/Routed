import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

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
    <div className="space-y-7">
      {/* Calm vs Fast - organic spacing */}
      <div className="space-y-3">
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground/80">calm</span>
          <span className="text-muted-foreground/80">swift</span>
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

      {/* Economy vs Comfort - asymmetric positioning */}
      <div className="space-y-3" style={{ marginLeft: '2px' }}>
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground/80">mindful</span>
          <span className="text-muted-foreground/80">comfort</span>
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

      {/* City familiarity toggle - humble, optional feel */}
      <div className="flex items-center gap-3 pt-2 opacity-80">
        <Checkbox
          id="unfamiliar-toggle"
          checked={unfamiliarWithCity}
          onCheckedChange={(checked) => onUnfamiliarChange(checked === true)}
          className="border-border/60"
          data-testid="checkbox-unfamiliar"
        />
        <Label 
          htmlFor="unfamiliar-toggle" 
          className="text-sm text-muted-foreground/70 cursor-pointer font-normal"
        >
          this city is new to me
        </Label>
      </div>
    </div>
  );
}
