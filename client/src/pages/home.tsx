import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Sparkles, MapPin, Navigation, History, Settings, Clock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CitySelector } from "@/components/city-selector";
import { PreferenceSliders } from "@/components/preference-sliders";
import { RouteCard } from "@/components/route-card";
import { LoadingState } from "@/components/loading-state";
import { EmptyState } from "@/components/empty-state";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { RouteRecommendation, AgentResponse } from "@shared/schema";

export default function Home() {
  const [, setLocation] = useLocation();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [userNote, setUserNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [cityId, setCityId] = useState("nyc");
  const [calmVsFast, setCalmVsFast] = useState(30);
  const [economyVsComfort, setEconomyVsComfort] = useState(50);
  const [unfamiliarWithCity, setUnfamiliarWithCity] = useState(false);
  const [recommendation, setRecommendation] = useState<RouteRecommendation | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);

  const getRecommendation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/agent/recommend", {
        origin: origin.trim() || "Current location",
        destination,
        cityId,
        calmVsFast,
        economyVsComfort,
        unfamiliarWithCity,
        userNote: userNote.trim() || undefined,
      });
      return await response.json() as AgentResponse;
    },
    onSuccess: (data) => {
      setRecommendation(data.recommendation);
      setTripId(data.tripId);
    },
  });

  const startTrip = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/trips/${tripId}/start`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      setLocation(`/trip/${tripId}`);
    },
  });

  const handleSearch = () => {
    if (destination.trim()) {
      setRecommendation(null);
      getRecommendation.mutate();
    }
  };

  const handleStartTrip = () => {
    if (tripId) {
      startTrip.mutate();
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header - practical but calm */}
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border/40">
        <div className="max-w-lg mx-auto px-5 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/90 flex items-center justify-center">
                <MapPin className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-lg font-medium">movi</span>
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon"
                className="h-9 w-9"
                onClick={() => setLocation("/history")}
                data-testid="button-history"
              >
                <History className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon"
                className="h-9 w-9"
                onClick={() => setLocation("/preferences")}
                data-testid="button-preferences"
              >
                <Settings className="h-4 w-4" />
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-lg mx-auto px-5 py-6">
        {/* City selector - visible and practical */}
        <div className="mb-6">
          <CitySelector selectedCity={cityId} onCityChange={setCityId} />
        </div>

        {/* Main input card - organic but clear */}
        <div 
          className="p-5 rounded-xl bg-card border border-border/60 shadow-sm mb-6 animate-gentle-fade"
        >
          <div className="space-y-4">
            {/* Origin input */}
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">
                where are you starting from?
              </label>
              <div className="relative">
                <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="current location"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  className="pl-10 py-5 text-base"
                  data-testid="input-origin"
                />
              </div>
            </div>

            {/* Destination input */}
            <div>
              <label className="text-sm text-muted-foreground mb-2 block">
                where are you going?
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                <Input
                  placeholder="enter destination..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-10 pr-10 py-5 text-base"
                  data-testid="input-destination"
                />
                <button
                  onClick={() => setShowNote(!showNote)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-colors ${
                    showNote ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title="add a note"
                  data-testid="button-note"
                >
                  <MessageCircle className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Optional note */}
            {showNote && (
              <div className="animate-gentle-fade">
                <textarea
                  placeholder="anything I should know? (e.g., heavy luggage, mobility needs)"
                  value={userNote}
                  onChange={(e) => setUserNote(e.target.value)}
                  className="w-full p-3 text-sm bg-muted/50 border border-border/50 rounded-lg resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  rows={2}
                  data-testid="input-note"
                />
              </div>
            )}
          </div>
        </div>

        {/* Preferences - always visible for practical use */}
        <div className="p-5 rounded-xl bg-card border border-border/60 shadow-sm mb-6 animate-gentle-fade">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">your preferences</h3>
          <PreferenceSliders
            calmVsFast={calmVsFast}
            economyVsComfort={economyVsComfort}
            unfamiliarWithCity={unfamiliarWithCity}
            onCalmVsFastChange={setCalmVsFast}
            onEconomyVsComfortChange={setEconomyVsComfort}
            onUnfamiliarChange={setUnfamiliarWithCity}
          />
          
          {/* Visual preference summary - practical feedback */}
          <div className="flex items-center gap-4 mt-5 pt-4 border-t border-border/40 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <span>{calmVsFast < 40 ? "prefer calm" : calmVsFast > 60 ? "prefer fast" : "balanced"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" />
              <span>{economyVsComfort < 40 ? "budget-friendly" : economyVsComfort > 60 ? "comfort first" : "balanced"}</span>
            </div>
          </div>
        </div>

        {/* Search button - clear and prominent */}
        <Button 
          className="w-full py-6 text-base gap-2 mb-4" 
          size="lg"
          onClick={handleSearch}
          disabled={!destination.trim() || getRecommendation.isPending}
          data-testid="button-find-route"
        >
          <Sparkles className="h-4 w-4" />
          find the best way
        </Button>

        {/* Tagline */}
        <p className="text-xs text-center text-muted-foreground mb-8">
          ai-powered route recommendations
        </p>

        {/* Results */}
        {getRecommendation.isPending && (
          <div className="animate-gentle-fade">
            <LoadingState />
          </div>
        )}

        {getRecommendation.isError && (
          <div className="animate-gentle-fade">
            <EmptyState type="error" />
          </div>
        )}

        {recommendation && !getRecommendation.isPending && (
          <div className="space-y-4 animate-gentle-fade">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">recommended route</span>
            </div>
            <RouteCard 
              recommendation={recommendation} 
              onSelect={handleStartTrip}
              isLoading={startTrip.isPending}
            />
          </div>
        )}

        {!recommendation && !getRecommendation.isPending && !getRecommendation.isError && (
          <EmptyState type="search" />
        )}
      </main>
    </div>
  );
}
