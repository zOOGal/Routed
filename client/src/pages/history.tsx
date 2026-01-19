import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Clock, CheckCircle2, XCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import type { Trip } from "@shared/schema";

const statusConfig = {
  planned: { icon: PlayCircle, color: "bg-chart-4", label: "Planned" },
  in_progress: { icon: PlayCircle, color: "bg-primary", label: "In Progress" },
  completed: { icon: CheckCircle2, color: "bg-accent", label: "Completed" },
  cancelled: { icon: XCircle, color: "bg-destructive", label: "Cancelled" },
};

export default function History() {
  const [, setLocation] = useLocation();

  const { data: trips, isLoading } = useQuery<Trip[]>({
    queryKey: ["/api/trips"],
  });

  const formatDate = (date: string | Date | null) => {
    if (!date) return "";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="container max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <h1 className="font-semibold">Trip History</h1>
            <div className="w-16" />
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-6">
        {isLoading && <LoadingState message="Loading trips..." />}

        {!isLoading && (!trips || trips.length === 0) && (
          <EmptyState type="trips" />
        )}

        {trips && trips.length > 0 && (
          <div className="space-y-4">
            {trips.map((trip) => {
              const status = statusConfig[trip.status as keyof typeof statusConfig] || statusConfig.planned;
              const StatusIcon = status.icon;

              return (
                <Card 
                  key={trip.id} 
                  className="hover-elevate cursor-pointer"
                  onClick={() => setLocation(`/trip/${trip.id}`)}
                  data-testid={`card-trip-${trip.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className={`${status.color} p-2 rounded-lg`}>
                        <StatusIcon className="h-5 w-5 text-white" />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{trip.originName}</p>
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              <p className="text-sm truncate">{trip.destinationName}</p>
                            </div>
                          </div>
                          <Badge variant="secondary" className="flex-shrink-0">
                            {status.label}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {trip.estimatedDuration} min
                          </span>
                          <span>{formatDate(trip.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
