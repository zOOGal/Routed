import { Slider } from "@/components/ui/slider";

interface PreferenceSliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  leftLabel?: string;
  rightLabel?: string;
  testId?: string;
}

export function PreferenceSlider({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onChange,
  leftLabel,
  rightLabel,
  testId,
}: PreferenceSliderProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium">{label}</label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="w-full"
        data-testid={testId}
      />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  );
}
