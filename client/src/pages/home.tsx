import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Sparkles, MapPin, History, Settings } from "lucide-react";
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
  const [destination, setDestination] = useState("");
  const [userNote, setUserNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [cityId, setCityId] = useState("nyc");
  const [calmVsFast, setCalmVsFast] = useState(30);
  const [economyVsComfort, setEconomyVsComfort] = useState(50);
  const [unfamiliarWithCity, setUnfamiliarWithCity] = useState(false);
  const [recommendation, setRecommendation] = useState<RouteRecommendation | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const getRecommendation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/agent/recommend", {
        origin: "Current location",
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
      setHasSearched(true);
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

  const hasDestination = destination.trim().length > 0;

  return (
    <div className="min-h-screen">
      {/* Minimal header - Kanso (simplicity) */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="max-w-2xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            {/* Logo - slightly off-center feel with asymmetric spacing */}
            <div className="flex items-center gap-3 pl-1">
              <span className="text-xl font-medium tracking-tight">movi</span>
            </div>
            {/* Muted navigation icons */}
            <div className="flex items-center gap-0.5 opacity-60 hover:opacity-100 transition-opacity duration-500">
              <Button 
                variant="ghost" 
                size="icon"
                className="h-9 w-9 rounded-full"
                onClick={() => setLocation("/history")}
                data-testid="button-history"
              >
                <History className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon"
                className="h-9 w-9 rounded-full"
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

      {/* Main content - generous negative space (Ma) */}
      <main className="max-w-md mx-auto px-6 pt-28 pb-12">
        {/* City selector - subtle, secondary */}
        <div className="mb-10 opacity-70">
          <CitySelector selectedCity={cityId} onCityChange={setCityId} />
        </div>

        {/* Intent area - Kanso & Seijaku */}
        <div className="space-y-8">
          {/* Destination input - organic, calm shape */}
          <div 
            className="relative p-6 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/50 shadow-sm animate-gentle-fade"
            style={{ 
              marginLeft: '-4px', // Fukinsei - slight asymmetry
              borderRadius: '1.25rem 1rem 1.25rem 1rem' // Organic, imperfect curvature
            }}
          >
            <div className="space-y-4">
              {/* Warm, inviting heading - Kanso lowercase */}
              <h1 className="text-2xl font-normal tracking-tight leading-relaxed">
                where would you like to go?
              </h1>
              
              {/* Input with organic feel */}
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                <Input
                  placeholder="Enter a place..."
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-11 pr-12 py-6 text-base bg-background/50 border-border/40 rounded-xl placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/30"
                  data-testid="input-destination"
                />
                {/* Subtle note button - Shibui (quiet beauty) */}
                <button
                  onClick={() => setShowNote(!showNote)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all duration-300 ${
                    showNote ? 'bg-primary/10 text-primary' : 'text-muted-foreground/40 hover:text-muted-foreground/70'
                  }`}
                  style={{ marginRight: '2px' }} // Fukinsei - slight offset
                  title="Anything I should know?"
                  data-testid="button-note"
                >
                  <MessageCircle className="h-4 w-4" />
                </button>
              </div>

              {/* Note input - progressive disclosure (Yūgen) */}
              {showNote && (
                <div className="animate-gentle-fade">
                  <textarea
                    placeholder="Anything I should know? (optional)"
                    value={userNote}
                    onChange={(e) => setUserNote(e.target.value)}
                    className="w-full p-4 text-sm bg-background/30 border border-border/30 rounded-xl resize-none placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
                    rows={2}
                    data-testid="input-note"
                  />
                </div>
              )}

              {/* Origin hint - humble, quiet */}
              <p className="text-sm text-muted-foreground/60 pl-1">
                from your current location
              </p>
            </div>
          </div>

          {/* Preferences - progressive disclosure (Yūgen) */}
          {hasDestination && (
            <div 
              className="animate-gentle-fade px-2"
              style={{ animationDelay: '0.1s' }}
            >
              <PreferenceSliders
                calmVsFast={calmVsFast}
                economyVsComfort={economyVsComfort}
                unfamiliarWithCity={unfamiliarWithCity}
                onCalmVsFastChange={setCalmVsFast}
                onEconomyVsComfortChange={setEconomyVsComfort}
                onUnfamiliarChange={setUnfamiliarWithCity}
              />
            </div>
          )}

          {/* Search button - appears with destination */}
          {hasDestination && (
            <div 
              className="animate-gentle-fade pt-2"
              style={{ 
                animationDelay: '0.2s',
                paddingLeft: '8px' // Fukinsei - asymmetric alignment
              }}
            >
              <Button 
                className="w-full py-6 text-base font-normal rounded-xl gap-2 transition-all duration-300" 
                size="lg"
                onClick={handleSearch}
                disabled={!destination.trim() || getRecommendation.isPending}
                data-testid="button-find-route"
              >
                <Sparkles className="h-4 w-4 animate-breathe" />
                find the way
              </Button>
              
              {/* Tagline - Seijaku (tranquility) */}
              <p className="text-xs text-center text-muted-foreground/50 mt-4 tracking-wide">
                guided by your mobility companion
              </p>
            </div>
          )}
        </div>

        {/* Results area - gentle reveal */}
        <div className="mt-12">
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
            <div className="space-y-5 animate-gentle-fade">
              <div className="flex items-center gap-2 pl-1 opacity-60">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="text-xs tracking-wide">
                  suggested journey
                </span>
              </div>
              <RouteCard 
                recommendation={recommendation} 
                onSelect={handleStartTrip}
                isLoading={startTrip.isPending}
              />
            </div>
          )}

          {!hasSearched && !getRecommendation.isPending && !getRecommendation.isError && !recommendation && (
            <div className="animate-gentle-fade opacity-50">
              <EmptyState type="search" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
