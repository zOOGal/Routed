import { useState } from "react";
import { MapPin, Navigation, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface LocationInputProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  icon?: "origin" | "destination";
  testId?: string;
}

export function LocationInput({
  label,
  placeholder,
  value,
  onChange,
  icon = "origin",
  testId,
}: LocationInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="relative">
      <label className="text-xs font-medium text-muted-foreground mb-1 block">
        {label}
      </label>
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg border bg-card transition-all ${
          isFocused ? "border-primary ring-2 ring-primary/20" : "border-border"
        }`}
      >
        {icon === "origin" ? (
          <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0" />
        ) : (
          <MapPin className="h-4 w-4 text-destructive flex-shrink-0" />
        )}
        <Input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="border-0 p-0 h-auto bg-transparent focus-visible:ring-0 text-base"
          data-testid={testId}
        />
        {value && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onChange("")}
            data-testid={`button-clear-${testId}`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
