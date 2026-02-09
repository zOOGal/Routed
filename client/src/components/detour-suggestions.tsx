import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  MapPin,
  Clock,
  Utensils,
  Coffee,
  Sparkles,
  Star,
  X,
  Loader2,
  TreePine,
  Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface DetourSuggestion {
  poi_id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  category: string | null;
  adds_minutes: number;
  corridor_distance_km: number;
  social_score: number;
  why_special: string;
  what_to_order: string[];
  warnings: string[];
  vibe_tags: string[];
  confidence: number;
  sources_count: Record<string, number>;
  is_open: boolean | null;
}

interface DetourSuggestResponse {
  suggestions: DetourSuggestion[];
  corridor_buffer_km: number;
  note: string;
}

interface DetourSuggestionsProps {
  isOpen: boolean;
  onClose: () => void;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}

const CATEGORIES = [
  { id: "any", label: "All", icon: Sparkles },
  { id: "food", label: "Food", icon: Utensils },
  { id: "cafe", label: "Cafe", icon: Coffee },
  { id: "attraction", label: "Sights", icon: Star },
  { id: "nature", label: "Nature", icon: TreePine },
  { id: "nightlife", label: "Nightlife", icon: Music },
] as const;

function getTotalSources(sources: Record<string, number>): number {
  return Object.values(sources).reduce((sum, n) => sum + n, 0);
}

function SuggestionCard({ suggestion }: { suggestion: DetourSuggestion }) {
  const totalSources = getTotalSources(suggestion.sources_count);

  return (
    <div className="routed-card p-4 space-y-3">
      {/* Header: name + category + detour time */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-foreground truncate">{suggestion.name}</h4>
            {suggestion.category && (
              <Badge variant="secondary" className="text-xs capitalize shrink-0">
                {suggestion.category}
              </Badge>
            )}
          </div>
          {suggestion.address && (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{suggestion.address}</span>
            </p>
          )}
        </div>
        <Badge className="shrink-0 bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
          <Clock className="h-3 w-3 mr-1" />
          +{Math.round(suggestion.adds_minutes)} min
        </Badge>
      </div>

      {/* Why special */}
      {suggestion.why_special && (
        <p className="text-sm text-foreground/80 leading-relaxed">
          {suggestion.why_special}
        </p>
      )}

      {/* What to order chips */}
      {suggestion.what_to_order.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestion.what_to_order.map((item, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {/* Vibe tags + source count */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-1">
          {suggestion.vibe_tags.slice(0, 4).map((tag, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        {totalSources > 0 && (
          <span className="text-xs text-muted-foreground shrink-0 ml-2">
            {totalSources} mention{totalSources !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export function DetourSuggestions({
  isOpen,
  onClose,
  originLat,
  originLng,
  destLat,
  destLng,
}: DetourSuggestionsProps) {
  const [selectedCategory, setSelectedCategory] = useState("any");

  const suggestMutation = useMutation({
    mutationFn: async (category: string) => {
      const response = await apiRequest("POST", "/api/detours/suggest", {
        originLat,
        originLng,
        destLat,
        destLng,
        category: category === "any" ? undefined : category,
        maxDetourMinutes: 15,
      });
      return (await response.json()) as DetourSuggestResponse;
    },
  });

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    suggestMutation.mutate(category);
  };

  // Fetch on first open
  const hasLoaded = suggestMutation.data || suggestMutation.isPending || suggestMutation.isError;
  if (isOpen && !hasLoaded) {
    suggestMutation.mutate(selectedCategory);
  }

  if (!isOpen) return null;

  const suggestions = suggestMutation.data?.suggestions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative mt-auto bg-background rounded-t-2xl border-t border-border/40 shadow-2xl max-h-[80vh] flex flex-col animate-float-in">
        {/* Handle + header */}
        <div className="px-5 pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Discover Stops</h3>
              <p className="text-xs text-muted-foreground">Interesting places along your route</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Category filter */}
        <div className="px-5 py-2 border-b border-border/40">
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {CATEGORIES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={selectedCategory === id ? "default" : "outline"}
                size="sm"
                className="shrink-0 gap-1.5 rounded-full text-xs"
                onClick={() => handleCategoryChange(id)}
                disabled={suggestMutation.isPending}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {suggestMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Finding interesting stops...</p>
            </div>
          )}

          {suggestMutation.isError && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-sm text-muted-foreground">Couldn't load suggestions</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => suggestMutation.mutate(selectedCategory)}
              >
                Try again
              </Button>
            </div>
          )}

          {suggestMutation.isSuccess && suggestions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <MapPin className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No suggestions found for this route</p>
              <p className="text-xs text-muted-foreground/70">Try a different category</p>
            </div>
          )}

          {suggestMutation.isSuccess && suggestions.length > 0 && (
            <>
              {suggestions.map((suggestion) => (
                <SuggestionCard key={suggestion.poi_id} suggestion={suggestion} />
              ))}
              {suggestMutation.data?.note && (
                <p className="text-xs text-muted-foreground/60 text-center pt-2 pb-4">
                  {suggestMutation.data.note}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
