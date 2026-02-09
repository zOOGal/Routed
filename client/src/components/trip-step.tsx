import { useState } from "react";
import {
  Footprints,
  Train,
  Car,
  Clock,
  ArrowRight,
  ExternalLink,
  Check,
  Circle,
  Map,
  Bike,
  Ticket,
  BadgeCheck,
  Loader2,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { RideBookingModal } from "./ride-booking-modal";
import type { RouteStep } from "@shared/schema";

const stepIcons = {
  walk: Footprints,
  transit: Train,
  rideshare: Car,
  wait: Clock,
  transfer: ArrowRight,
  bike: Bike,
};

interface RideRequestResult {
  provider: {
    id: string;
    name: string;
    type: string;
  };
  estimate: {
    priceMin: number;
    priceMax: number;
    currency: string;
    pickupEtaMin: number;
    tripDurationMin: number;
  };
  execution: {
    type: string;
    url?: string;
    label?: string;
  };
  selectionReason?: string;
}

interface TripStepProps {
  step: RouteStep & {
    coverage?: "included" | "discounted" | "pay" | "unknown";
    costLabel?: string;
    providerName?: string;
    execution?: {
      type: "walk" | "deeplink" | "ticket" | "system_map" | "hail" | "phone" | "unavailable";
      url?: string;
      phone?: string;
      label?: string;
    };
    // Quote-specific fields
    isEstimate?: boolean;
    priceLabel?: string;
    pickupEtaMin?: number;
    quoteProviderId?: string;
    // Coordinates for ride request
    startCoords?: { lat: number; lng: number };
    endCoords?: { lat: number; lng: number };
  };
  index: number;
  isActive: boolean;
  isCompleted: boolean;
  onComplete: () => void;
  cityId?: string;
  userNote?: string;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  JPY: "¥",
};

function formatRidePrice(min: number, max: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] || "$";
  if (currency === "JPY") {
    return `${symbol}${min.toLocaleString()}–${max.toLocaleString()}`;
  }
  return `${symbol}${(min / 100).toFixed(0)}–${(max / 100).toFixed(0)}`;
}

export function TripStep({ step, index, isActive, isCompleted, onComplete, cityId, userNote }: TripStepProps) {
  const StepIcon = stepIcons[step.type] || Circle;
  const [isRequestingRide, setIsRequestingRide] = useState(false);
  const [rideResult, setRideResult] = useState<RideRequestResult | null>(null);
  const [rideError, setRideError] = useState<string | null>(null);
  const [showRideModal, setShowRideModal] = useState(false);

  // Check if DEMO_MODE is enabled (for showing demo labels)
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === "1" || import.meta.env.DEV;

  const handleRequestRide = async () => {
    // If we have coordinates, use the in-app ride modal
    if (step.startCoords && step.endCoords) {
      setShowRideModal(true);
      return;
    }

    // Fallback to legacy flow for backward compatibility
    if (!step.startCoords || !step.endCoords || !cityId) {
      if (step.deepLink) {
        window.open(step.deepLink, "_blank");
      }
      return;
    }

    setIsRequestingRide(true);
    setRideError(null);

    try {
      const response = await apiRequest("POST", "/api/request-ride", {
        cityCode: cityId,
        origin: step.startCoords,
        destination: step.endCoords,
        userNote,
      });

      const result = await response.json();

      if (result.success) {
        setRideResult(result);
        if (result.execution?.url) {
          window.open(result.execution.url, "_blank");
        }
      } else {
        setRideError(result.error || "Failed to request ride");
      }
    } catch (error) {
      setRideError("Failed to request ride");
      if (step.deepLink) {
        window.open(step.deepLink, "_blank");
      }
    } finally {
      setIsRequestingRide(false);
    }
  };

  const handleRideBookingComplete = () => {
    // Mark the step as ready to complete when ride finishes
    setRideResult({ 
      provider: { id: "demo", name: "Ride (demo)", type: "ridehail" },
      estimate: { priceMin: 0, priceMax: 0, currency: "USD", pickupEtaMin: 0, tripDurationMin: 0 },
      execution: { type: "in_app" }
    });
  };

  return (
    <div
      className={`relative flex gap-4 pb-6 ${index === 0 ? "" : ""}`}
      data-testid={`trip-step-${index}`}
    >
      <div className="flex flex-col items-center">
        <div
          className={`
            w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0
            transition-all duration-300
            ${isCompleted
              ? "bg-primary text-primary-foreground"
              : isActive
                ? "bg-primary text-primary-foreground ring-4 ring-primary/20 shadow-lg shadow-primary/20"
                : "bg-secondary text-muted-foreground border border-border/50"
            }
          `}
        >
          {isCompleted ? (
            <Check className="h-5 w-5" />
          ) : (
            <StepIcon className="h-5 w-5" />
          )}
        </div>
        <div className={`
          w-0.5 flex-1 mt-2 rounded-full transition-colors duration-300
          ${isCompleted
            ? "bg-gradient-to-b from-primary/60 to-primary/20"
            : "bg-border/50"
          }
        `} />
      </div>

      <div className={`flex-1 pb-4 transition-opacity duration-200 ${isActive ? "" : "opacity-60"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="font-semibold capitalize mb-1 text-foreground">
              {step.type === "transit" && step.line ? `Take ${step.line}` : step.type}
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {step.instruction}
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 bg-secondary/50 px-2.5 py-1 rounded-full">
                <Clock className="h-3 w-3" />
                {step.duration} min
              </span>
              {step.distance && (
                <span className="bg-secondary/50 px-2.5 py-1 rounded-full">
                  {Math.round(step.distance)} m
                </span>
              )}
              {step.stopsCount && (
                <span className="bg-secondary/50 px-2.5 py-1 rounded-full">
                  {step.stopsCount} stops
                </span>
              )}
              {/* Coverage badge */}
              {step.coverage === "included" && step.costLabel && (
                <span className="flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2.5 py-1 rounded-full">
                  <BadgeCheck className="h-3 w-3" />
                  {step.costLabel}
                </span>
              )}
              {step.coverage === "discounted" && step.costLabel && (
                <span className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2.5 py-1 rounded-full">
                  <Ticket className="h-3 w-3" />
                  {step.costLabel}
                </span>
              )}
              {step.coverage === "pay" && step.costLabel && step.type !== "walk" && (
                <span className="bg-secondary/50 px-2.5 py-1 rounded-full">
                  {step.costLabel}
                </span>
              )}
              {/* Estimated price from quotes */}
              {step.priceLabel && step.isEstimate && (
                <span className="flex items-center gap-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-full">
                  Est. {step.priceLabel}
                </span>
              )}
              {/* Pickup ETA */}
              {step.pickupEtaMin && step.type === "rideshare" && (
                <span className="flex items-center gap-1 bg-secondary/50 px-2.5 py-1 rounded-full">
                  <Clock className="h-3 w-3" />
                  ~{step.pickupEtaMin} min pickup
                </span>
              )}
            </div>

            {step.transitDetails && (
              <div className="mt-3 text-xs bg-secondary/50 rounded-xl px-4 py-3 border border-border/30">
                <div className="flex items-center gap-2 text-foreground/80">
                  {step.transitDetails.vehicleType && (
                    <span className="font-semibold capitalize">{step.transitDetails.vehicleType.toLowerCase()}</span>
                  )}
                  {step.transitDetails.departureTime && (
                    <span className="text-primary font-medium">Departs {step.transitDetails.departureTime}</span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                  <span>{step.transitDetails.departureStop}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span>{step.transitDetails.arrivalStop}</span>
                </div>
              </div>
            )}

            {/* Execution action (inside step card) */}
            {step.execution && step.execution.type !== "walk" && step.execution.type !== "unavailable" && (
              <>
                {/* Deep link / URL action */}
                {step.execution.url && (
                  <button
                    className="mt-3 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={async () => {
                      try {
                        await apiRequest("POST", "/api/events", {
                          eventType: "opened_maps",
                          context: { stepIndex: index, stepType: step.type, executionType: step.execution?.type },
                        });
                      } catch {
                        // Silent fail
                      }
                      window.open(step.execution!.url, "_blank");
                    }}
                    data-testid={`button-execution-${index}`}
                  >
                    {step.execution.type === "system_map" && <Map className="h-3.5 w-3.5" />}
                    {step.execution.type === "deeplink" && <ExternalLink className="h-3.5 w-3.5" />}
                    {step.execution.type === "ticket" && <Ticket className="h-3.5 w-3.5" />}
                    {step.execution.label || (step.execution.type === "system_map" ? "View system map" : "Open ride")}
                  </button>
                )}
                {/* Phone action */}
                {step.execution.type === "phone" && step.execution.phone && (
                  <a
                    href={`tel:${step.execution.phone}`}
                    className="mt-3 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`button-phone-${index}`}
                  >
                    <Car className="h-3.5 w-3.5" />
                    {step.execution.label || "Call for pickup"}
                  </a>
                )}
                {/* Hail instruction */}
                {step.execution.type === "hail" && !step.execution.url && (
                  <div className="mt-3 px-3 py-2 text-xs text-muted-foreground bg-secondary/30 rounded-xl flex items-center gap-2">
                    <Car className="h-3.5 w-3.5" />
                    {step.execution.label || "Hail taxi on street"}
                  </div>
                )}
              </>
            )}
            {/* Fallback to old navigationDeepLink format */}
            {!step.execution && step.navigationDeepLink && (
              <button
                className="mt-3 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={async () => {
                  try {
                    await apiRequest("POST", "/api/events", {
                      eventType: "opened_maps",
                      context: { stepIndex: index, stepType: step.type },
                    });
                  } catch {
                    // Silent fail
                  }
                  window.open(step.navigationDeepLink, "_blank");
                }}
                data-testid={`button-maps-${index}`}
              >
                <Map className="h-3.5 w-3.5" />
                View on map
              </button>
            )}
          </div>

          {isActive && (
            <div className="flex flex-col gap-2 flex-shrink-0">
              {/* Rideshare: Request Ride button */}
              {step.type === "rideshare" && !rideResult && (
                <div className="flex flex-col gap-1.5">
                  <Button
                    size="sm"
                    className="gap-1.5 rounded-xl"
                    onClick={handleRequestRide}
                    disabled={isRequestingRide}
                    data-testid={`button-request-ride-${index}`}
                  >
                    {isRequestingRide ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Finding ride...
                      </>
                    ) : (
                      <>
                        <Car className="h-3 w-3" />
                        Request Ride
                      </>
                    )}
                  </Button>
                  {/* Demo label - shown in dev mode */}
                  {isDemoMode && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 justify-center">
                      <AlertCircle className="h-2.5 w-2.5" />
                      Demo provider
                    </span>
                  )}
                </div>
              )}

              {/* Show ride result after request */}
              {step.type === "rideshare" && rideResult && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-muted-foreground bg-secondary/50 px-3 py-2 rounded-xl">
                    <div className="font-medium text-foreground">{rideResult.provider.name}</div>
                    {rideResult.estimate.priceMax > 0 && (
                      <>
                        <div>Est. {formatRidePrice(rideResult.estimate.priceMin, rideResult.estimate.priceMax, rideResult.estimate.currency)}</div>
                        <div>~{rideResult.estimate.pickupEtaMin} min pickup</div>
                      </>
                    )}
                  </div>
                  {rideResult.execution?.url && (
                    <Button
                      size="sm"
                      className="gap-1.5 rounded-xl"
                      onClick={() => window.open(rideResult.execution.url, "_blank")}
                      data-testid={`button-open-ride-app-${index}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open {rideResult.provider.name}
                    </Button>
                  )}
                </div>
              )}

              {rideError && (
                <div className="text-xs text-red-500">{rideError}</div>
              )}

              {/* Non-rideshare: existing buttons */}
              {step.type !== "rideshare" && step.deepLink && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-xl"
                  onClick={() => window.open(step.deepLink, "_blank")}
                  data-testid={`button-open-app-${index}`}
                >
                  <ExternalLink className="h-3 w-3" />
                  Open
                </Button>
              )}

              {/* Complete/Arrived button */}
              <Button
                size="sm"
                variant={step.type === "rideshare" && rideResult ? "default" : "default"}
                className="rounded-xl"
                onClick={onComplete}
                data-testid={`button-complete-step-${index}`}
              >
                {step.type === "rideshare" ? "Arrived" : "Done"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* In-app Ride Booking Modal */}
      {step.startCoords && step.endCoords && (
        <RideBookingModal
          isOpen={showRideModal}
          onClose={() => setShowRideModal(false)}
          pickupLat={step.startCoords.lat}
          pickupLng={step.startCoords.lng}
          pickupAddress={step.transitDetails?.departureStop || step.instruction.split(" to ")[0] || "Pickup"}
          dropoffLat={step.endCoords.lat}
          dropoffLng={step.endCoords.lng}
          dropoffAddress={step.transitDetails?.arrivalStop || step.instruction.split(" to ")[1] || "Dropoff"}
          onBookingComplete={handleRideBookingComplete}
        />
      )}
    </div>
  );
}
