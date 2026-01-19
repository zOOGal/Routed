import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Navigation, Settings, History, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LocationInput } from "@/components/location-input";
import { CitySelector } from "@/components/city-selector";
import { MoodSelector } from "@/components/mood-selector";
import { RouteCard } from "@/components/route-card";
import { LoadingState } from "@/components/loading-state";
import { EmptyState } from "@/components/empty-state";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { RouteRecommendation, AgentResponse, TravelMood } from "@shared/schema";

export default function Home() {
  const [, setLocation] = useLocation();
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [cityId, setCityId] = useState("nyc");
  const [mood, setMood] = useState<TravelMood>("normal");
  const [recommendation, setRecommendation] = useState<RouteRecommendation | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);

  const getRecommendation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/agent/recommend", {
        origin,
        destination,
        cityId,
        mood,
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
    if (origin.trim() && destination.trim()) {
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="container max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                <Navigation className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">Movi</span>
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setLocation("/history")}
                data-testid="button-history"
              >
                <History className="h-5 w-5" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setLocation("/preferences")}
                data-testid="button-preferences"
              >
                <Settings className="h-5 w-5" />
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-6">
        <div className="mb-6">
          <CitySelector selectedCity={cityId} onCityChange={setCityId} />
        </div>

        <Card className="mb-6">
          <CardContent className="p-4 space-y-4">
            <MoodSelector selectedMood={mood} onMoodChange={setMood} />
            <div className="border-t pt-4 space-y-4">
              <LocationInput
                label="From"
                placeholder="Enter starting point"
                value={origin}
                onChange={setOrigin}
                icon="origin"
                testId="input-origin"
              />
              <LocationInput
                label="To"
                placeholder="Where are you going?"
                value={destination}
                onChange={setDestination}
                icon="destination"
                testId="input-destination"
              />
            </div>
            <Button 
              className="w-full gap-2" 
              size="lg"
              onClick={handleSearch}
              disabled={!origin.trim() || !destination.trim() || getRecommendation.isPending}
              data-testid="button-find-route"
            >
              <Sparkles className="h-4 w-4" />
              Find Best Route
            </Button>
          </CardContent>
        </Card>

        {getRecommendation.isPending && <LoadingState />}

        {getRecommendation.isError && (
          <EmptyState type="error" />
        )}

        {recommendation && !getRecommendation.isPending && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">
                AI Recommendation
              </span>
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
