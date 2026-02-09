import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  MapPin,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Navigation,
  Train,
  Car,
  Footprints,
  Bike,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TripStep } from "@/components/trip-step";
import { StressMeter } from "@/components/stress-meter";
import { TripDetailsSkeleton } from "@/components/skeleton-states";
import { TripCompletion } from "@/components/trip-completion";
import { DetourSuggestions } from "@/components/detour-suggestions";
import { ResponsibilityLine } from "@/components/depth-insights";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Trip, RouteStep, RouteRecommendation, DepthLayerOutput } from "@shared/schema";

// Mode icons and display config
const MODE_CONFIG: Record<string, { icon: typeof Train; label: string; gradient: string }> = {
  transit: { icon: Train, label: "Transit", gradient: "from-blue-500/20 to-blue-600/10" },
  rideshare: { icon: Car, label: "Rideshare", gradient: "from-purple-500/20 to-purple-600/10" },
  walk: { icon: Footprints, label: "Walking", gradient: "from-green-500/20 to-green-600/10" },
  bike: { icon: Bike, label: "Cycling", gradient: "from-orange-500/20 to-orange-600/10" },
  mixed: { icon: Navigation, label: "Mixed", gradient: "from-primary/20 to-accent/10" },
};

function generateGoogleMapsLink(origin: string, destination: string, mode: string = "transit"): string {
  const params = new URLSearchParams({
    api: "1",
    origin: origin,
    destination: destination,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function getGoogleMapsLink(trip: Trip): string {
  const recommendation = trip.recommendation as RouteRecommendation | null;

  if (recommendation?.googleMapsLink) {
    return recommendation.googleMapsLink;
  }

  const mode = recommendation?.mode === "rideshare" ? "driving"
    : recommendation?.mode === "walk" ? "walking"
    : recommendation?.mode === "bike" ? "bicycling"
    : "transit";

  return generateGoogleMapsLink(trip.originName, trip.destinationName, mode);
}

// Recommendation Card Component
function RecommendationCard({
  mode,
  reasoning,
  duration,
  costDisplay,
  stressScore,
  responsibilityLine,
}: {
  mode: string;
  reasoning: string;
  duration: number | null;
  costDisplay?: string | null;
  stressScore?: number | null;
  responsibilityLine?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const config = MODE_CONFIG[mode] || MODE_CONFIG.mixed;
  const ModeIcon = config.icon;

  // Extract key benefit from reasoning (first sentence or phrase)
  const keyBenefit = reasoning.split(/[.!]/)[0].trim();
  const hasMoreDetail = reasoning.length > keyBenefit.length + 5;

  return (
    <div className="mb-6 animate-float-in" style={{ animationDelay: '0.1s' }}>
      {/* Main recommendation card */}
      <div className={`routed-card overflow-hidden border-2 border-primary/20`}>
        {/* Gradient header */}
        <div className={`bg-gradient-to-r ${config.gradient} px-5 py-4`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-background/80 backdrop-blur flex items-center justify-center shadow-sm">
              <ModeIcon className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-primary uppercase tracking-wider">
                  Recommended for you
                </span>
              </div>
              <h3 className="text-lg font-semibold text-foreground mt-0.5">
                {config.label} Route
              </h3>
            </div>
          </div>
        </div>

        {/* Key benefit */}
        <div className="px-5 py-4 border-b border-border/40">
          <p className="text-sm text-foreground leading-relaxed">
            {keyBenefit}.
          </p>
          
          {/* Expandable details */}
          {hasMoreDetail && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Less detail
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  More detail
                </>
              )}
            </button>
          )}
          
          {isExpanded && hasMoreDetail && (
            <p className="text-sm text-muted-foreground leading-relaxed mt-3 pl-3 border-l-2 border-primary/20">
              {reasoning.slice(keyBenefit.length + 1).trim()}
            </p>
          )}
        </div>

        {/* Quick stats */}
        <div className="px-5 py-3 bg-secondary/30 flex items-center gap-4 text-sm">
          {duration && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{duration} min</span>
            </div>
          )}
          {costDisplay && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">{costDisplay}</span>
            </div>
          )}
          {stressScore !== null && stressScore !== undefined && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                stressScore <= 3 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                stressScore <= 6 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}>
                {stressScore <= 3 ? 'Low stress' : stressScore <= 6 ? 'Moderate' : 'Higher stress'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Responsibility line - subtle note below */}
      {responsibilityLine && (
        <div className="mt-3 px-2">
          <ResponsibilityLine text={responsibilityLine} />
        </div>
      )}
    </div>
  );
}

export default function TripPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showCompletion, setShowCompletion] = useState(false);
  const [wasInProgress, setWasInProgress] = useState(false);
  const [showDetours, setShowDetours] = useState(false);

  const { data: trip, isLoading } = useQuery<Trip>({
    queryKey: ["/api/trips", id],
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (trip?.status === "in_progress") {
      setWasInProgress(true);
    }
    if (trip?.status === "completed" && wasInProgress) {
      setShowCompletion(true);
    }
  }, [trip?.status, wasInProgress]);

  const completeStep = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/trips/${id}/step/complete`);
      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });

      // If trip was completed (profileUpdated flag), invalidate profile cache
      if (data?.profileUpdated) {
        queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
        console.log("[trip] Trip completed, profile invalidated. New totalTrips:", data.profile?.totalTrips);
      }
    },
    onError: () => {
      toast({
        title: "Couldn't update step",
        description: "Please try again.",
        variant: "destructive",
      });
    },
  });

  const cancelTrip = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/trips/${id}/cancel`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", id] });
      setLocation("/");
    },
  });

  const replan = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/trips/${id}/replan`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", id] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
          <div className="container max-w-lg mx-auto px-4 py-3">
            <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2 rounded-xl">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </header>
        <main className="container max-w-lg mx-auto px-4 py-6">
          <TripDetailsSkeleton />
        </main>
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
          <div className="container max-w-lg mx-auto px-4 py-3">
            <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2 rounded-xl">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
        </header>
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">Trip not found</p>
        </div>
      </div>
    );
  }

  const steps = (trip.steps as RouteStep[]) || [];
  const currentStepIndex = trip.currentStepIndex || 0;
  const isCompleted = trip.status === "completed";
  const isCancelled = trip.status === "cancelled";
  const depthLayer = trip.depthLayer as DepthLayerOutput | null;

  return (
    <div className="min-h-screen bg-background pb-28 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/3 -right-1/4 w-[600px] h-[600px] rounded-full bg-primary/[0.03] blur-3xl" />
        <div className="absolute -bottom-1/3 -left-1/4 w-[500px] h-[500px] rounded-full bg-accent/[0.04] blur-3xl" />
      </div>

      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="container max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2 rounded-xl" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Badge
              variant={isCompleted ? "default" : isCancelled ? "destructive" : "secondary"}
              className="capitalize rounded-full px-3"
            >
              {trip.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-6 relative z-10">
        {/* Trip summary card */}
        <div className="routed-card p-5 mb-6 animate-float-in">
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-3.5 h-3.5 rounded-full bg-primary ring-4 ring-primary/20" />
              <div className="w-0.5 h-12 bg-gradient-to-b from-primary/40 to-accent/40 rounded-full" />
              <div className="w-4 h-4 text-accent">
                <MapPin className="w-full h-full" />
              </div>
            </div>
            <div className="flex-1 space-y-5">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">From</p>
                <p className="font-medium text-foreground">{trip.originName}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">To</p>
                <p className="font-medium text-foreground">{trip.destinationName}</p>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-border/40 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{trip.estimatedDuration} min</span>
            </div>
            {trip.stressScore !== null && (
              <div className="flex-1">
                <StressMeter score={trip.stressScore || 0} size="sm" />
              </div>
            )}
          </div>
        </div>

        {/* Why This Route - Recommendation Card */}
        {trip.reasoning && !isCompleted && !isCancelled && (() => {
          const recommendation = trip.recommendation as RouteRecommendation | null;
          return (
            <RecommendationCard
              mode={recommendation?.mode || "transit"}
              reasoning={trip.reasoning}
              duration={trip.estimatedDuration}
              costDisplay={recommendation?.costDisplay}
              stressScore={trip.stressScore}
              responsibilityLine={depthLayer?.responsibilityLine}
            />
          );
        })()}

        {/* Progress card */}
        <div className="routed-card overflow-hidden animate-float-in" style={{ animationDelay: '0.2s' }}>
          <div className="p-5 pb-4 border-b border-border/40">
            <h2 className="text-lg font-semibold flex items-center gap-2.5">
              {isCompleted ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Trip Completed
                </>
              ) : isCancelled ? (
                <>
                  <XCircle className="h-5 w-5 text-destructive" />
                  Trip Cancelled
                </>
              ) : (
                <>
                  <div className="accent-dot" />
                  Trip Progress
                </>
              )}
            </h2>
          </div>
          <div className="p-5 pt-4">
            <div className="space-y-0">
              {steps.map((step, index) => {
                // For rideshare steps, add coordinates for ride request
                const stepWithCoords = step.type === "rideshare" ? {
                  ...step,
                  startCoords: trip.originLat && trip.originLng
                    ? { lat: trip.originLat, lng: trip.originLng }
                    : undefined,
                  endCoords: trip.destinationLat && trip.destinationLng
                    ? { lat: trip.destinationLat, lng: trip.destinationLng }
                    : undefined,
                } : step;

                return (
                  <TripStep
                    key={index}
                    step={stepWithCoords}
                    index={index}
                    isActive={index === currentStepIndex && !isCompleted && !isCancelled}
                    isCompleted={index < currentStepIndex || isCompleted}
                    onComplete={() => completeStep.mutate()}
                    cityId={trip.cityId}
                    userNote={trip.intent}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Bottom action bar */}
      {!isCompleted && !isCancelled && (
        <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-xl border-t border-border/40 p-4 z-40">
          <div className="container max-w-lg mx-auto">
            <div className="flex gap-3">
              {trip.originLat && trip.originLng && trip.destinationLat && trip.destinationLng && (
                <Button
                  variant="outline"
                  className="flex-1 gap-2 rounded-xl py-5 border-primary/30 text-primary hover:bg-primary/5"
                  onClick={() => setShowDetours(true)}
                >
                  <Compass className="h-4 w-4" />
                  Discover Stops
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-1 gap-2 rounded-xl py-5"
                onClick={() => replan.mutate()}
                disabled={replan.isPending}
                data-testid="button-replan"
              >
                <RefreshCw className="h-4 w-4" />
                Replan
              </Button>
              <Button
                variant="secondary"
                className="flex-1 text-destructive hover:text-destructive rounded-xl py-5"
                onClick={() => cancelTrip.mutate()}
                disabled={cancelTrip.isPending}
                data-testid="button-cancel-trip"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Detour suggestions sheet */}
      {trip.originLat && trip.originLng && trip.destinationLat && trip.destinationLng && (
        <DetourSuggestions
          isOpen={showDetours}
          onClose={() => setShowDetours(false)}
          originLat={trip.originLat}
          originLng={trip.originLng}
          destLat={trip.destinationLat}
          destLng={trip.destinationLng}
        />
      )}

      {/* Trip completion celebration */}
      {showCompletion && trip && (
        <TripCompletion
          trip={trip}
          onDismiss={() => {
            setShowCompletion(false);
            setLocation("/");
          }}
        />
      )}
    </div>
  );
}
