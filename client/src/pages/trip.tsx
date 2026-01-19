import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  ArrowLeft, 
  MapPin, 
  Clock, 
  CheckCircle2,
  XCircle,
  RefreshCw,
  Navigation
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TripStep } from "@/components/trip-step";
import { StressMeter } from "@/components/stress-meter";
import { LoadingState } from "@/components/loading-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Trip, RouteStep } from "@shared/schema";

export default function TripPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();

  const { data: trip, isLoading } = useQuery<Trip>({
    queryKey: ["/api/trips", id],
    refetchInterval: 5000,
  });

  const completeStep = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/trips/${id}/step/complete`);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips", id] });
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <LoadingState message="Loading trip details..." />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
          <div className="container max-w-lg mx-auto px-4 py-3">
            <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2">
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

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="container max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <Badge 
              variant={isCompleted ? "default" : isCancelled ? "destructive" : "secondary"}
              className="capitalize"
            >
              {trip.status}
            </Badge>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-6">
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <div className="w-0.5 h-10 bg-border" />
                <MapPin className="h-4 w-4 text-destructive" />
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">From</p>
                  <p className="font-medium">{trip.originName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">To</p>
                  <p className="font-medium">{trip.destinationName}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{trip.estimatedDuration} min</span>
              </div>
              {trip.stressScore !== null && (
                <div className="flex-1">
                  <StressMeter score={trip.stressScore || 0} size="sm" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {trip.reasoning && (
          <Card className="mb-6 bg-primary/5 border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Navigation className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {trip.reasoning}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              {isCompleted ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-accent" />
                  Trip Completed
                </>
              ) : isCancelled ? (
                <>
                  <XCircle className="h-5 w-5 text-destructive" />
                  Trip Cancelled
                </>
              ) : (
                <>
                  <Navigation className="h-5 w-5 text-primary" />
                  Trip Progress
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-0">
              {steps.map((step, index) => (
                <TripStep
                  key={index}
                  step={step}
                  index={index}
                  isActive={index === currentStepIndex && !isCompleted && !isCancelled}
                  isCompleted={index < currentStepIndex || isCompleted}
                  onComplete={() => completeStep.mutate()}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </main>

      {!isCompleted && !isCancelled && (
        <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-lg border-t p-4">
          <div className="container max-w-lg mx-auto flex gap-3">
            <Button 
              variant="outline" 
              className="flex-1 gap-2"
              onClick={() => replan.mutate()}
              disabled={replan.isPending}
              data-testid="button-replan"
            >
              <RefreshCw className="h-4 w-4" />
              Replan
            </Button>
            <Button 
              variant="destructive" 
              className="flex-1"
              onClick={() => cancelTrip.mutate()}
              disabled={cancelTrip.isPending}
              data-testid="button-cancel-trip"
            >
              Cancel Trip
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
