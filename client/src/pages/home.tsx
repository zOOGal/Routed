import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, MessageSquare, X, MapPin, RefreshCw, Sparkles, Menu, User, Clock, HelpCircle, Info, Ticket, Navigation, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlaceAutocomplete } from "@/components/place-autocomplete";
import { IntentSelector } from "@/components/intent-selector";
import { DepthInsights, TripFraming, ResponsibilityLine } from "@/components/depth-insights";
import { RecommendationSkeleton } from "@/components/skeleton-states";
import { HelpAboutSheet } from "@/components/help-about-sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";
import type { RouteRecommendation, AgentResponse, UserPackage, TripIntent, DepthLayerOutput, Trip } from "@shared/schema";

const CITIES = [
  { id: "nyc", name: "New York", country: "USA" },
  { id: "tokyo", name: "Tokyo", country: "Japan" },
  { id: "berlin", name: "Berlin", country: "Germany" },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { cityId, setCityId } = useCity();
  const [destination, setDestination] = useState("");
  const [userNote, setUserNote] = useState("");
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showCityMenu, setShowCityMenu] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showHelpAbout, setShowHelpAbout] = useState(false);

  // Active trip banner dismiss
  const [dismissedTripId, setDismissedTripId] = useState<string | null>(null);

  // Origin/starting location
  const [origin, setOrigin] = useState("");
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  // Trip intent (optional)
  const [intent, setIntent] = useState<TripIntent>("leisure");

  // Preferences (hidden by default)
  const [gentleness, setGentleness] = useState(30);
  const [costCare, setCostCare] = useState(1);
  const [unfamiliarWithCity, setUnfamiliarWithCity] = useState(false);

  const [recommendation, setRecommendation] = useState<RouteRecommendation | null>(null);
  const [depthLayer, setDepthLayer] = useState<DepthLayerOutput | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [cityMismatch, setCityMismatch] = useState<{
    message: string;
    suggestedCityCode?: string;
    suggestedCityName?: string;
    confidence?: number;
  } | null>(null);

  const city = CITIES.find((c) => c.id === cityId) || CITIES[0];

  useEffect(() => {
    if (useCurrentLocation && !currentCoords && !isLocating) {
      setIsLocating(true);
      setLocationError(null);

      if (!navigator.geolocation) {
        setLocationError("Geolocation is not supported by your browser");
        setIsLocating(false);
        setUseCurrentLocation(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentCoords({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setIsLocating(false);
        },
        (error) => {
          setLocationError(
            error.code === 1 ? "Location access denied. Please enter your starting point manually."
              : "Could not get your location. Please enter your starting point manually."
          );
          setIsLocating(false);
          setUseCurrentLocation(false);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  }, [useCurrentLocation, currentCoords, isLocating]);

  const { data: activePackage } = useQuery<UserPackage | null>({
    queryKey: ["/api/user/active-package", cityId],
    queryFn: async () => {
      const response = await fetch(`/api/user/active-package?cityId=${cityId}`);
      return response.json();
    },
  });

  // Active trip banner
  const { data: allTrips } = useQuery<Trip[]>({
    queryKey: ["/api/trips"],
  });
  const activeTrip = allTrips
    ?.filter((t) => t.status === "in_progress" || t.status === "planned")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;

  const getRecommendation = useMutation({
    mutationFn: async () => {
      const economyVsComfort = costCare === 0 ? 20 : costCare === 1 ? 50 : 80;

      let originString: string;
      if (useCurrentLocation && currentCoords) {
        originString = `${currentCoords.lat},${currentCoords.lng}`;
      } else if (origin.trim()) {
        originString = origin.trim();
      } else {
        throw new Error("Please enter a starting location or enable location access");
      }

      const response = await fetch("/api/agent/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: originString,
          destination,
          cityId,
          intent,
          calmVsFast: gentleness,
          economyVsComfort,
          unfamiliarWithCity,
          userNote: userNote.trim() || undefined,
        }),
      });

      const data = await response.json();

      // Handle city mismatch error specially
      if (!response.ok && data.error === "city_mismatch") {
        throw { type: "city_mismatch", ...data };
      }

      if (!response.ok) {
        throw new Error(data.message || "Failed to get recommendation");
      }

      return data as AgentResponse & { depthLayer?: DepthLayerOutput };
    },
    onSuccess: (data) => {
      setCityMismatch(null);
      setRecommendation(data.recommendation);
      setDepthLayer(data.depthLayer || null);
      setTripId(data.tripId);
    },
    onError: (error: any) => {
      if (error?.type === "city_mismatch") {
        setCityMismatch({
          message: error.message,
          suggestedCityCode: error.mismatch?.suggestedCityCode,
          suggestedCityName: error.mismatch?.suggestedCityName,
          confidence: error.mismatch?.confidence,
        });
        setRecommendation(null);
        return;
      }

      setCityMismatch(null);
      toast({
        title: "Couldn't find a route",
        description: error instanceof Error ? error.message : "Please try a different destination.",
        variant: "destructive",
      });
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

  const handleCitySelect = (id: string) => {
    setCityId(id);
    setShowCityMenu(false);
    setCityMismatch(null);
  };

  const handleDelegate = () => {
    if (canSearch) {
      setRecommendation(null);
      setDepthLayer(null);
      getRecommendation.mutate();
    }
  };

  const hasDestination = destination.trim().length > 0;
  const hasValidOrigin = (useCurrentLocation && currentCoords) || origin.trim().length > 0;
  const canSearch = hasDestination && hasValidOrigin && !isLocating;

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Subtle background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-primary/[0.03] blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-accent/[0.04] blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="px-6 py-4">
          <div className="max-w-md mx-auto flex items-center justify-between">
            {/* City selector */}
            <div className="relative">
              <button
                onClick={() => setShowCityMenu(!showCityMenu)}
                className="routed-pill bg-secondary/80 hover:bg-secondary border border-border/50"
              >
                <MapPin className="h-4 w-4 text-primary" />
                <span className="font-medium text-foreground">{city.name}</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showCityMenu ? 'rotate-180' : ''}`} />
              </button>

              {showCityMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowCityMenu(false)}
                  />
                  <div className="absolute top-full left-0 mt-2 bg-card rounded-2xl border border-border/50 shadow-lg py-2 min-w-[200px] z-50 overflow-hidden animate-scale-in">
                    {CITIES.map((c, i) => (
                      <button
                        key={c.id}
                        onClick={() => handleCitySelect(c.id)}
                        className={`w-full px-4 py-3 text-left text-sm transition-all flex items-center gap-3 ${
                          c.id === cityId
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/50 text-foreground"
                        }`}
                        style={{ animationDelay: `${i * 0.05}s` }}
                      >
                        <MapPin className={`h-4 w-4 ${c.id === cityId ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="font-medium">{c.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Menu button */}
            <button
              onClick={() => setShowMenu(true)}
              className="p-2.5 rounded-xl hover:bg-secondary/60 transition-colors"
              aria-label="Menu"
            >
              <Menu className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </div>
      </header>

      {/* Menu drawer */}
      {showMenu && (
        <>
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={() => setShowMenu(false)}
          />
          <div className="fixed top-0 right-0 h-full w-72 bg-card border-l border-border/50 shadow-2xl z-50 animate-slide-in-right">
            <div className="p-6">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-lg font-semibold">Menu</h2>
                <button
                  onClick={() => setShowMenu(false)}
                  className="p-2 -mr-2 rounded-xl hover:bg-secondary/50 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="space-y-1">
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setLocation("/account");
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors text-left"
                >
                  <User className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Account</span>
                </button>

                <button
                  onClick={() => {
                    setShowMenu(false);
                    setLocation("/history");
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors text-left"
                >
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Trip history</span>
                </button>

                <div className="my-4 border-t border-border/30" />

                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowHelpAbout(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors text-left"
                >
                  <HelpCircle className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Help</span>
                </button>

                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowHelpAbout(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-secondary/50 transition-colors text-left"
                >
                  <Info className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">About</span>
                </button>
              </nav>
            </div>
          </div>
        </>
      )}

      {/* Main content */}
      <main className="px-6 pb-16 relative z-10">
        <div className="max-w-md mx-auto">
          {/* Active trip banner */}
          {activeTrip && activeTrip.id !== dismissedTripId && (
            <div className="mt-6 mb-2 animate-float-in">
              <div className="routed-card p-4 border-primary/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Navigation className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-primary uppercase tracking-wider">
                        {activeTrip.status === "in_progress" ? "Trip in progress" : "Planned trip"}
                      </p>
                      <p className="text-sm font-medium text-foreground truncate">
                        {activeTrip.originName} → {activeTrip.destinationName}
                      </p>
                      {activeTrip.estimatedDuration && (
                        <p className="text-xs text-muted-foreground mt-0.5">{activeTrip.estimatedDuration} min</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setDismissedTripId(activeTrip.id)}
                    className="p-1 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                    aria-label="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 rounded-xl gap-2"
                    onClick={() => {
                      setUseCurrentLocation(false);
                      setOrigin(activeTrip.originName);
                      setDestination(activeTrip.destinationName);
                      if (activeTrip.intent) {
                        setIntent(activeTrip.intent as TripIntent);
                      }
                      setUserNote(activeTrip.userNote || "");
                      setDismissedTripId(activeTrip.id);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 rounded-xl gap-2"
                    onClick={() => setLocation(`/trip/${activeTrip.id}`)}
                  >
                    Continue
                    <Navigation className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Hero section with serif heading */}
          <div className="mt-12 mb-10 animate-float-in">
            <h1 className="text-5xl font-semibold text-foreground tracking-tight mb-3 leading-[1.1]">
              Where to?
            </h1>
            <p className="text-lg text-muted-foreground font-light">
              I'll find the calmest way there.
            </p>
          </div>

          {/* Main input card */}
          <div
            className="routed-card p-6 space-y-5 animate-float-in"
            style={{ animationDelay: '0.1s' }}
          >
            {/* Origin input */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                From
              </label>
              {useCurrentLocation ? (
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-secondary/50 rounded-xl text-sm border border-border/30">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <span className={isLocating ? "text-muted-foreground" : "text-foreground font-medium"}>
                      {isLocating ? "Getting your location..." : currentCoords ? "Current location" : "Location unavailable"}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setUseCurrentLocation(false);
                      setOrigin("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-muted/50"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <PlaceAutocomplete
                      value={origin}
                      onChange={setOrigin}
                      placeholder="Enter starting point"
                      cityId={cityId}
                      testId="input-origin"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setUseCurrentLocation(true);
                      setCurrentCoords(null);
                    }}
                    className="text-xs text-primary hover:text-primary/80 transition-colors px-3 py-2 rounded-lg hover:bg-primary/5 font-medium"
                  >
                    Use GPS
                  </button>
                </div>
              )}
              {locationError && (
                <p className="text-xs text-destructive mt-2 pl-1">{locationError}</p>
              )}
            </div>

            {/* Destination input */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                To
              </label>
              <PlaceAutocomplete
                value={destination}
                onChange={setDestination}
                placeholder="Where would you like to go?"
                cityId={cityId}
                onKeyDown={(e) => e.key === 'Enter' && canSearch && handleDelegate()}
                testId="input-destination"
              />
            </div>

            {/* Divider with note */}
            <div className="flex items-center justify-between pt-4 border-t border-border/40">
              <p className="text-sm text-muted-foreground/80 italic font-light">
                I'll take care of the details.
              </p>
              <button
                onClick={() => setShowNoteModal(true)}
                className={`p-2.5 rounded-xl transition-all ${
                  userNote
                    ? "text-primary bg-primary/10 hover:bg-primary/15"
                    : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50"
                }`}
                aria-label="Add note"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* After destination: intent, CTA, preferences */}
          {hasDestination && (
            <div className="mt-8 space-y-5 animate-float-in" style={{ animationDelay: '0.15s' }}>
              {/* Intent selector */}
              <IntentSelector value={intent} onChange={setIntent} />

              {/* Primary CTA */}
              <Button
                className="w-full py-7 text-base rounded-2xl font-medium shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/25 transition-all duration-300"
                onClick={handleDelegate}
                disabled={getRecommendation.isPending || !canSearch}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {getRecommendation.isPending ? "Finding your way..." : isLocating ? "Getting location..." : "Let me decide"}
              </Button>

              {/* Preferences toggle */}
              <button
                onClick={() => setShowPreferences(!showPreferences)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                <span>Adjust preferences</span>
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showPreferences ? 'rotate-180' : ''}`} />
              </button>

              <div>

                {showPreferences && (
                  <div className="mt-4 routed-card p-6 space-y-7 animate-scale-in">
                    {/* Gentleness slider */}
                    <div>
                      <label className="text-sm font-medium text-foreground mb-4 block">
                        How gentle should this be?
                      </label>
                      <div className="space-y-3">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={gentleness}
                          onChange={(e) => setGentleness(Number(e.target.value))}
                          className="w-full h-2 bg-secondary rounded-full appearance-none cursor-pointer accent-primary"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Relaxed pace</span>
                          <span>Direct route</span>
                        </div>
                      </div>
                    </div>

                    {/* Cost preference */}
                    <div>
                      <label className="text-sm font-medium text-foreground mb-4 block">
                        How much should I care about cost?
                      </label>
                      <div className="flex bg-secondary/50 rounded-xl p-1.5 border border-border/30">
                        {["Economical", "Balanced", "Comfortable"].map((label, i) => (
                          <button
                            key={label}
                            onClick={() => setCostCare(i)}
                            className={`flex-1 py-2.5 text-sm rounded-lg transition-all duration-200 ${
                              costCare === i
                                ? "bg-card text-foreground shadow-sm font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Unfamiliar toggle */}
                    <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-sm font-medium text-foreground group-hover:text-foreground/80 transition-colors">
                        I don't know this city well
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={unfamiliarWithCity}
                        onClick={() => setUnfamiliarWithCity(!unfamiliarWithCity)}
                        className={`w-12 h-7 rounded-full transition-all duration-200 relative ${
                          unfamiliarWithCity ? "bg-primary" : "bg-secondary border border-border/50"
                        }`}
                      >
                        <div
                          className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                            unfamiliarWithCity ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </label>

                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loading state */}
          {getRecommendation.isPending && (
            <div className="mt-10 space-y-4 animate-float-in">
              <div className="flex items-center gap-3">
                <div className="accent-dot" />
                <p className="text-sm font-medium text-foreground">Finding the best way...</p>
              </div>
              <RecommendationSkeleton />
            </div>
          )}

          {/* City mismatch warning */}
          {cityMismatch && (
            <div className="mt-10 routed-card p-6 border-amber-500/30 bg-amber-500/5 animate-scale-in">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <MapPin className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">
                    This looks like {cityMismatch.suggestedCityName || "a different city"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {cityMismatch.message}
                  </p>
                  <div className="flex gap-3 mt-4">
                    {cityMismatch.suggestedCityCode && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setCityId(cityMismatch.suggestedCityCode!);
                          setCityMismatch(null);
                          // Trigger new search after city switch
                          setTimeout(() => getRecommendation.mutate(), 100);
                        }}
                        className="gap-2 rounded-xl"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Switch to {cityMismatch.suggestedCityName}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCityMismatch(null);
                      }}
                      className="rounded-xl"
                    >
                      Keep {city.name}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error state */}
          {getRecommendation.isError && !cityMismatch && (
            <div className="mt-10 routed-card p-6 border-destructive/30 animate-scale-in">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <p className="font-medium text-foreground">Couldn't find a route</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Check your destination or try again.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => getRecommendation.mutate()}
                  className="gap-2 rounded-xl"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Result */}
          {recommendation && !getRecommendation.isPending && (
            <div className="mt-10 space-y-4 animate-float-in">
              <div className="flex items-center gap-3">
                <div className="accent-dot" />
                <p className="text-sm font-medium text-foreground">Here's my recommendation</p>
              </div>

              <div className="routed-card overflow-hidden">
                {/* Header */}
                <div className="p-6 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-foreground">{recommendation.summary}</h3>
                      <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                        <span className="font-medium">{recommendation.estimatedDuration} min</span>
                        {(recommendation.costDisplay || recommendation.estimatedCost !== null) && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-border" />
                            <span>{recommendation.costDisplay || "Standard fare"}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="px-3 py-1.5 text-xs font-medium bg-primary/10 text-primary rounded-full capitalize">
                      {recommendation.mode}
                    </span>
                  </div>

                  {/* Trip framing */}
                  {depthLayer?.tripFramingLine && (
                    <TripFraming framingLine={depthLayer.tripFramingLine} className="mt-4" />
                  )}

                  {/* Ease indicator */}
                  {recommendation.stressScore !== undefined && (
                    <div className="mt-5 flex items-center gap-3">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ease</span>
                      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
                          style={{ width: `${(1 - recommendation.stressScore) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-foreground">
                        {recommendation.stressScore < 0.3 ? "Easy" : recommendation.stressScore < 0.6 ? "Moderate" : "Demanding"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Insights */}
                {depthLayer && (depthLayer.contextualInsights.length > 0 || depthLayer.memoryCallbackLine) && (
                  <div className="px-6 py-4 bg-muted/30 border-t border-border/40">
                    <DepthInsights depthLayer={depthLayer} />
                  </div>
                )}

                {/* Steps */}
                <div className="p-6 pt-4 border-t border-border/40 space-y-4">
                  {recommendation.steps.map((step, index) => (
                    <div key={index} className="flex items-start gap-4 text-sm group">
                      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5 group-hover:bg-primary/15 transition-colors">
                        {index + 1}
                      </div>
                      <div className="flex-1 pt-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground capitalize">{step.type}</span>
                          {step.line && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent rounded-full">
                              {step.line}
                            </span>
                          )}
                          <span className="text-muted-foreground">· {step.duration} min</span>
                        </div>
                        <p className="text-muted-foreground mt-1">{step.instruction}</p>
                        {step.transitDetails && (
                          <div className="mt-2 text-xs bg-secondary/50 rounded-xl px-3 py-2 border border-border/30">
                            <div className="flex items-center gap-2 text-foreground/80">
                              {step.transitDetails.departureTime && (
                                <span className="font-semibold">{step.transitDetails.departureTime}</span>
                              )}
                              <span>{step.transitDetails.departureStop}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                              <span>→</span>
                              <span>{step.transitDetails.arrivalStop}</span>
                              {step.stopsCount && (
                                <span className="ml-1">({step.stopsCount} stops)</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Pass coverage - only shown when relevant */}
                  {activePackage && recommendation.steps.some(s =>
                    ['subway', 'bus', 'transit', 'train', 'metro', 'tram'].includes(s.type.toLowerCase())
                  ) && (
                    <div className="flex items-center gap-2 pt-3 mt-3 border-t border-border/30 text-sm text-muted-foreground">
                      <Ticket className="h-4 w-4" />
                      <span>Your pass covers transit on this route.</span>
                    </div>
                  )}
                </div>

                {/* Responsibility line */}
                {depthLayer?.responsibilityLine && (
                  <div className="px-6 py-3 border-t border-border/40">
                    <ResponsibilityLine text={depthLayer.responsibilityLine} />
                  </div>
                )}

                {/* CTA */}
                <div className="p-6 pt-4 border-t border-border/40">
                  <Button
                    className="w-full py-6 rounded-xl font-medium"
                    onClick={() => tripId && startTrip.mutate()}
                    disabled={startTrip.isPending}
                  >
                    {startTrip.isPending ? "Starting trip..." : "Use this route"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Note modal */}
      {showNoteModal && (
        <>
          <div
            className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-40 animate-fade-in"
            onClick={() => setShowNoteModal(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 bg-card rounded-t-3xl border-t border-border/50 p-6 z-50 shadow-2xl animate-slide-up">
            <div className="max-w-md mx-auto">
              {/* Handle */}
              <div className="w-12 h-1.5 bg-border rounded-full mx-auto mb-6" />

              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-xl font-semibold">Anything I should know?</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tell me anything that matters for this trip.
                  </p>
                </div>
                <button
                  onClick={() => setShowNoteModal(false)}
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-xl hover:bg-muted/50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <textarea
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                placeholder="I'm tired, keep it simple..."
                className="routed-input w-full h-28 resize-none"
                autoFocus
              />

              <p className="text-xs text-muted-foreground/70 mt-3 mb-5">
                Examples: "I don't want to walk much" · "I have a reservation at 3pm"
              </p>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl py-5"
                  onClick={() => setShowNoteModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 rounded-xl py-5"
                  onClick={() => setShowNoteModal(false)}
                >
                  Save note
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Help & About Sheet */}
      <HelpAboutSheet 
        isOpen={showHelpAbout} 
        onClose={() => setShowHelpAbout(false)} 
      />
    </div>
  );
}
