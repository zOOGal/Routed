/**
 * RIDE BOOKING MODAL
 *
 * In-app ride request experience using the DEMO provider.
 * Shows quotes, booking status, and driver info.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Car,
  Clock,
  DollarSign,
  MapPin,
  User,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Star,
  Navigation,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";

// Types from the broker
interface RideQuote {
  id: string;
  providerId: string;
  providerName: string;
  tier: "economy" | "comfort" | "premium";
  priceEstimateCents: number;
  currency: string;
  priceDisplay: string;
  pickupEtaMinutes: number;
  tripDurationMinutes: number;
  distanceMeters: number;
  isDemo: boolean;
  demoDisclaimer?: string;
}

interface RideBooking {
  id: string;
  status: string;
  statusMessage?: string;
  priceDisplay: string;
  pickupAddress: string;
  dropoffAddress: string;
  driver?: {
    name: string;
    rating: number;
    vehicleMake: string;
    vehicleModel: string;
    vehicleColor: string;
    licensePlate: string;
  };
  etaMinutes?: number;
  isDemo: boolean;
  demoDisclaimer?: string;
}

interface QuoteAggregation {
  quotes: RideQuote[];
  cheapest?: RideQuote;
  fastest?: RideQuote;
  errors: Array<{ providerId: string; error: string }>;
}

interface RideBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress: string;
  tripId?: string;
  stepIndex?: number;
  onBookingComplete?: () => void;
}

const TIER_INFO = {
  economy: {
    label: "Economy",
    description: "Affordable rides",
    icon: "🚗",
  },
  comfort: {
    label: "Comfort",
    description: "More space & comfort",
    icon: "🚙",
  },
  premium: {
    label: "Premium",
    description: "Luxury experience",
    icon: "🚘",
  },
};

const STATUS_INFO: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  requested: {
    label: "Finding driver",
    color: "text-amber-500",
    icon: <Loader2 className="h-5 w-5 animate-spin" />,
  },
  driver_assigned: {
    label: "Driver on the way",
    color: "text-blue-500",
    icon: <Car className="h-5 w-5" />,
  },
  arriving: {
    label: "Driver arriving",
    color: "text-green-500",
    icon: <Navigation className="h-5 w-5" />,
  },
  in_progress: {
    label: "In transit",
    color: "text-primary",
    icon: <Car className="h-5 w-5" />,
  },
  completed: {
    label: "Completed",
    color: "text-green-600",
    icon: <CheckCircle2 className="h-5 w-5" />,
  },
  cancelled: {
    label: "Cancelled",
    color: "text-muted-foreground",
    icon: <X className="h-5 w-5" />,
  },
  failed: {
    label: "Failed",
    color: "text-red-500",
    icon: <AlertTriangle className="h-5 w-5" />,
  },
};

export function RideBookingModal({
  isOpen,
  onClose,
  pickupLat,
  pickupLng,
  pickupAddress,
  dropoffLat,
  dropoffLng,
  dropoffAddress,
  tripId,
  stepIndex,
  onBookingComplete,
}: RideBookingModalProps) {
  const [phase, setPhase] = useState<"quotes" | "booking" | "tracking">("quotes");
  const [quotes, setQuotes] = useState<QuoteAggregation | null>(null);
  const [selectedTier, setSelectedTier] = useState<"economy" | "comfort" | "premium">("economy");
  const [booking, setBooking] = useState<RideBooking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if DEMO_MODE should be prominently shown (always true for PoC)
  const showDemoLabel = import.meta.env.VITE_DEMO_MODE === "1" || import.meta.env.DEV;

  // Fetch quotes on open
  useEffect(() => {
    if (isOpen && phase === "quotes") {
      fetchQuotes();
    }
  }, [isOpen]);

  // Poll for status updates when booking
  useEffect(() => {
    if (phase !== "tracking" || !booking) return;

    const terminalStatuses = ["completed", "cancelled", "failed"];
    if (terminalStatuses.includes(booking.status)) return;

    const interval = setInterval(async () => {
      try {
        const response = await apiRequest("GET", `/api/rides/${booking.id}/status`);
        const updated = await response.json();
        setBooking(updated);

        if (terminalStatuses.includes(updated.status)) {
          if (updated.status === "completed" && onBookingComplete) {
            onBookingComplete();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [phase, booking]);

  const fetchQuotes = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest("POST", "/api/rides/quote", {
        pickupLat,
        pickupLng,
        pickupAddress,
        dropoffLat,
        dropoffLng,
        dropoffAddress,
      });
      const data = await response.json();
      setQuotes(data);
    } catch (err) {
      setError("Failed to get ride quotes");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestRide = async () => {
    if (!quotes) return;

    const selectedQuote = quotes.quotes.find((q) => q.tier === selectedTier);
    if (!selectedQuote) {
      setError("Selected ride option not available");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiRequest("POST", "/api/rides/request", {
        quoteId: selectedQuote.id,
        passengerName: "Demo User", // In real app, would use user profile
        tripId,
        stepIndex,
      });

      const bookingData = await response.json();
      setBooking(bookingData);
      setPhase("tracking");
    } catch (err) {
      setError("Failed to request ride");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelRide = async () => {
    if (!booking) return;

    setLoading(true);
    try {
      const response = await apiRequest("POST", `/api/rides/${booking.id}/cancel`, {
        reason: "User cancelled",
      });
      const updated = await response.json();
      setBooking(updated);
    } catch (err) {
      setError("Failed to cancel ride");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset state
    setPhase("quotes");
    setQuotes(null);
    setBooking(null);
    setError(null);
    onClose();
  };

  const selectedQuote = quotes?.quotes.find((q) => q.tier === selectedTier);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            {phase === "quotes" && "Request a Ride"}
            {phase === "booking" && "Confirming Ride"}
            {phase === "tracking" && "Your Ride"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1 text-amber-600">
            <AlertCircle className="h-3.5 w-3.5" />
            DEMO — No real driver will arrive
          </DialogDescription>
        </DialogHeader>

        {/* Error display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* QUOTES PHASE */}
        {phase === "quotes" && (
          <div className="space-y-4">
            {/* Route summary */}
            <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                <span className="line-clamp-1">{pickupAddress}</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                <span className="line-clamp-1">{dropoffAddress}</span>
              </div>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}

            {quotes && !loading && (
              <>
                {/* Tier selection */}
                <div className="space-y-2">
                  {(["economy", "comfort", "premium"] as const).map((tier) => {
                    const quote = quotes.quotes.find((q) => q.tier === tier);
                    const tierInfo = TIER_INFO[tier];
                    const isSelected = selectedTier === tier;

                    if (!quote) return null;

                    return (
                      <button
                        key={tier}
                        onClick={() => setSelectedTier(tier)}
                        className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{tierInfo.icon}</span>
                            <div>
                              <div className="font-medium">{tierInfo.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {tierInfo.description}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">{quote.priceDisplay}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {quote.pickupEtaMinutes} min
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Request button */}
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleRequestRide}
                  disabled={loading || !selectedQuote}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Car className="h-4 w-4 mr-2" />
                  )}
                  Request {TIER_INFO[selectedTier].label}
                </Button>

                {/* Trip info */}
                {selectedQuote && (
                  <div className="flex justify-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      ~{selectedQuote.tripDurationMinutes} min trip
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {(selectedQuote.distanceMeters / 1000).toFixed(1)} km
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TRACKING PHASE */}
        {phase === "tracking" && booking && (
          <div className="space-y-4">
            {/* Status */}
            <div className="text-center py-4">
              <div className={`inline-flex items-center gap-2 ${STATUS_INFO[booking.status]?.color || "text-muted-foreground"}`}>
                {STATUS_INFO[booking.status]?.icon}
                <span className="text-lg font-semibold">
                  {STATUS_INFO[booking.status]?.label || booking.status}
                </span>
              </div>
              {booking.statusMessage && (
                <p className="text-sm text-muted-foreground mt-1">{booking.statusMessage}</p>
              )}
            </div>

            {/* Driver info */}
            {booking.driver && (
              <div className="bg-secondary/50 rounded-lg p-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">{booking.driver.name}</div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {booking.driver.rating.toFixed(1)}
                    </div>
                  </div>
                  {booking.etaMinutes !== undefined && (
                    <div className="text-right">
                      <div className="text-2xl font-bold">{booking.etaMinutes}</div>
                      <div className="text-xs text-muted-foreground">min away</div>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-3 border-t border-border/50 text-sm text-muted-foreground">
                  <div>
                    {booking.driver.vehicleColor} {booking.driver.vehicleMake} {booking.driver.vehicleModel}
                  </div>
                  <div className="font-mono">{booking.driver.licensePlate}</div>
                </div>
              </div>
            )}

            {/* Route */}
            <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                <span className="line-clamp-1">{booking.pickupAddress}</span>
              </div>
              <div className="flex items-start gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                <span className="line-clamp-1">{booking.dropoffAddress}</span>
              </div>
            </div>

            {/* Price */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Estimated fare</span>
              <span className="font-semibold">{booking.priceDisplay}</span>
            </div>

            {/* Cancel button */}
            {["requested", "driver_assigned", "arriving"].includes(booking.status) && (
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCancelRide}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <X className="h-4 w-4 mr-2" />
                )}
                Cancel Ride
              </Button>
            )}

            {/* Close button for terminal states */}
            {["completed", "cancelled", "failed"].includes(booking.status) && (
              <Button className="w-full" onClick={handleClose}>
                Close
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
