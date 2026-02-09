import { useEffect, useState } from "react";
import { CheckCircle2, MapPin, Clock, Footprints, Train } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Trip, RouteStep } from "@shared/schema";

interface TripCompletionProps {
  trip: Trip;
  onDismiss: () => void;
}

export function TripCompletion({ trip, onDismiss }: TripCompletionProps) {
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    // Animate in the stats after the checkmark
    const timer = setTimeout(() => setShowStats(true), 400);
    return () => clearTimeout(timer);
  }, []);

  const steps = (trip.steps as RouteStep[]) || [];

  // Calculate trip stats
  const walkingMinutes = steps
    .filter((s) => s.type === "walk")
    .reduce((acc, s) => acc + (s.duration || 0), 0);

  const transitMinutes = steps
    .filter((s) => s.type === "transit")
    .reduce((acc, s) => acc + (s.duration || 0), 0);

  const walkingDistance = steps
    .filter((s) => s.type === "walk")
    .reduce((acc, s) => acc + (s.distance || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/10 backdrop-blur-sm">
      <Card className="w-full max-w-sm mx-4 overflow-hidden border-border/30">
        <CardContent className="p-6 text-center">
          {/* Animated checkmark */}
          <div className="relative mb-6">
            <div className="w-20 h-20 mx-auto rounded-full bg-primary/15 flex items-center justify-center animate-[scale-in_0.3s_ease-out]">
              <CheckCircle2 className="h-12 w-12 text-primary animate-[fade-in_0.3s_ease-out_0.2s_both]" />
            </div>

            {/* Celebration particles - subtle */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-2 h-2 rounded-full bg-primary/40"
                  style={{
                    left: "50%",
                    top: "50%",
                    animation: `particle-${i} 0.6s ease-out 0.3s both`,
                  }}
                />
              ))}
            </div>
          </div>

          <h2 className="text-xl font-semibold mb-2">Trip Complete</h2>
          <p className="text-sm text-muted-foreground mb-6">
            You've arrived at {trip.destinationName}
          </p>

          {/* Trip stats */}
          <div
            className={`grid grid-cols-3 gap-4 mb-6 transition-all duration-500 ${
              showStats ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <div className="text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-secondary flex items-center justify-center">
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-lg font-medium">{trip.estimatedDuration}</p>
              <p className="text-xs text-muted-foreground">minutes</p>
            </div>

            {walkingMinutes > 0 && (
              <div className="text-center">
                <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-secondary flex items-center justify-center">
                  <Footprints className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-lg font-medium">
                  {walkingDistance > 0 ? `${Math.round(walkingDistance)}m` : `${walkingMinutes}min`}
                </p>
                <p className="text-xs text-muted-foreground">walked</p>
              </div>
            )}

            {transitMinutes > 0 && (
              <div className="text-center">
                <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-secondary flex items-center justify-center">
                  <Train className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-lg font-medium">{transitMinutes}</p>
                <p className="text-xs text-muted-foreground">min transit</p>
              </div>
            )}
          </div>

          <Button onClick={onDismiss} className="w-full">
            Done
          </Button>
        </CardContent>
      </Card>

      <style>{`
        @keyframes scale-in {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        ${[...Array(6)].map((_, i) => `
          @keyframes particle-${i} {
            from {
              transform: translate(-50%, -50%) scale(0);
              opacity: 1;
            }
            to {
              transform: translate(
                calc(-50% + ${Math.cos((i * 60 * Math.PI) / 180) * 40}px),
                calc(-50% + ${Math.sin((i * 60 * Math.PI) / 180) * 40}px)
              ) scale(1);
              opacity: 0;
            }
          }
        `).join("")}
      `}</style>
    </div>
  );
}
