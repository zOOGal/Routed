import { useState, useEffect, useRef } from "react";
import { MapPin, Loader2 } from "lucide-react";

interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface PlaceAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  cityId?: string;
  icon?: "origin" | "destination";
  onKeyDown?: (e: React.KeyboardEvent) => void;
  testId?: string;
}

export function PlaceAutocomplete({
  value,
  onChange,
  placeholder,
  cityId,
  icon = "destination",
  onKeyDown,
  testId,
}: PlaceAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Fetch suggestions with debounce
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!value || value.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ input: value });
        if (cityId) {
          params.append("cityId", cityId);
        }

        const response = await fetch(`/api/places/autocomplete?${params.toString()}`);
        const data = await response.json();

        setSuggestions(data);
        setShowSuggestions(data.length > 0);
        setSelectedIndex(-1);
      } catch (error) {
        console.error("Failed to fetch suggestions:", error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [value, cityId]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (suggestion: PlaceSuggestion) => {
    onChange(suggestion.description);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex]);
        return;
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    }

    onKeyDown?.(e);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          className="w-full py-2 text-base bg-transparent border-none outline-none placeholder:text-muted-foreground/50"
          data-testid={testId}
        />
        {isLoading && (
          <Loader2 className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-[100] w-full mt-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.placeId}
              className={`w-full px-4 py-3 text-left transition-colors flex items-start gap-3 ${
                index === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
              }`}
              onClick={() => handleSelect(suggestion)}
            >
              <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{suggestion.mainText}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {suggestion.secondaryText}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
