/**
 * PROFILE BADGE
 *
 * Badge showing trip count. Click opens a sheet with full profile details.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { User, MapPin, Footprints, RefreshCw, Compass } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface UserProfile {
  userId: string;
  prefs: {
    walkingToleranceMin: number;
    walkingToleranceMax: number;
    transferTolerance: number;
    calmQuickBias: number;
    costComfortBias: number;
    outdoorBias: number;
    replanSensitivity: number;
  };
  cityFamiliarity: Record<string, number>;
  totalTrips: number;
  lastTripAt: string | null;
  createdAt: string;
}

function PreferenceBar({
  label,
  value,
  leftLabel,
  rightLabel,
}: {
  label: string;
  value: number;
  leftLabel: string;
  rightLabel: string;
}) {
  // value is -1 to 1, convert to 0-100%
  const percent = ((value + 1) / 2) * 100;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{leftLabel}</span>
        <span className="font-medium text-foreground">{label}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/60 rounded-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function ProfileBadge() {
  const [open, setOpen] = useState(false);

  const { data: profile, isLoading, error } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    queryFn: async () => {
      const response = await fetch("/api/user/profile", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to load profile");
      }
      return response.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const totalTrips = profile?.totalTrips ?? 0;

  // Loading state for badge
  if (isLoading) {
    return (
      <div className="routed-pill bg-secondary/60 text-muted-foreground border border-border/40 text-xs">
        <User className="h-3.5 w-3.5" />
        <span className="w-4 h-3 bg-muted-foreground/20 rounded animate-pulse" />
      </div>
    );
  }

  const cityEntries = Object.entries(profile?.cityFamiliarity ?? {});
  const hasVisitedCities = cityEntries.length > 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        className={`routed-pill text-xs transition-all cursor-pointer hover:scale-105 active:scale-95 ${
          totalTrips > 0
            ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
            : "bg-secondary/60 text-muted-foreground border border-border/40 hover:bg-secondary/80"
        }`}
        title={`${totalTrips} trips completed`}
      >
        <User className="h-3.5 w-3.5" />
        <span className="font-medium tabular-nums">{totalTrips}</span>
      </button>

      <SheetContent side="right" className="w-[340px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Your Profile
          </SheetTitle>
          <SheetDescription>
            Routed learns your preferences as you travel
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
            Failed to load profile. Please try again.
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {/* Trip Stats */}
            <div className="flex items-center gap-4 p-4 bg-secondary/30 rounded-lg">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                <Compass className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">
                  {totalTrips}
                </div>
                <div className="text-sm text-muted-foreground">
                  {totalTrips === 1 ? "trip completed" : "trips completed"}
                </div>
              </div>
            </div>

            {/* Cities Visited */}
            {hasVisitedCities && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Cities Explored
                </h3>
                <div className="flex flex-wrap gap-2">
                  {cityEntries.map(([city, familiarity]) => (
                    <div
                      key={city}
                      className="px-3 py-1.5 bg-secondary/50 rounded-full text-xs font-medium capitalize"
                      title={`${Math.round(familiarity * 100)}% familiar`}
                    >
                      {city}
                      <span className="ml-1.5 text-muted-foreground">
                        {Math.round(familiarity * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Learned Preferences */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Footprints className="h-4 w-4" />
                Learned Preferences
              </h3>

              <div className="space-y-4 p-4 bg-secondary/20 rounded-lg">
                <PreferenceBar
                  label="Pace"
                  value={profile?.prefs.calmQuickBias ?? 0}
                  leftLabel="Calm"
                  rightLabel="Quick"
                />
                <PreferenceBar
                  label="Priority"
                  value={profile?.prefs.costComfortBias ?? 0}
                  leftLabel="Budget"
                  rightLabel="Comfort"
                />
                <PreferenceBar
                  label="Route"
                  value={profile?.prefs.outdoorBias ?? 0}
                  leftLabel="Indoor"
                  rightLabel="Outdoor"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-secondary/20 rounded-lg">
                  <div className="text-muted-foreground mb-1">Walking</div>
                  <div className="font-medium">
                    {profile?.prefs.walkingToleranceMin ?? 15}-
                    {profile?.prefs.walkingToleranceMax ?? 30} min
                  </div>
                </div>
                <div className="p-3 bg-secondary/20 rounded-lg">
                  <div className="text-muted-foreground mb-1">Transfers</div>
                  <div className="font-medium">
                    {profile?.prefs.transferTolerance === 0
                      ? "Minimize"
                      : profile?.prefs.transferTolerance === 1
                      ? "Don't mind"
                      : "Moderate"}
                  </div>
                </div>
              </div>
            </div>

            {/* Info Note */}
            <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-lg text-xs text-muted-foreground">
              <RefreshCw className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                These preferences update automatically as you complete trips and
                interact with route suggestions.
              </span>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
