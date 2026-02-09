import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { X, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";
import type { Package as PackageType, UserPackage } from "@shared/schema";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function Packages() {
  const [, setLocation] = useLocation();
  const { cityId } = useCity();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: packages = [], isLoading: packagesLoading } = useQuery<PackageType[]>({
    queryKey: ["/api/packages", cityId],
    queryFn: async () => {
      const response = await fetch(`/api/packages?cityId=${cityId}`);
      return response.json();
    },
  });

  const { data: activePackage, isLoading: activeLoading } = useQuery<UserPackage | null>({
    queryKey: ["/api/user/active-package", cityId],
    queryFn: async () => {
      const response = await fetch(`/api/user/active-package?cityId=${cityId}`);
      return response.json();
    },
  });

  const activatePackage = useMutation({
    mutationFn: async (packageId: string) => {
      const response = await apiRequest("POST", "/api/packages/activate", { packageId });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/active-package"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/packages"] });
    },
  });

  // Sort by duration (shortest first)
  const sorted = [...packages].sort((a, b) => a.durationDays - b.durationDays);

  // Default-select weekly when packages load and no active pass
  useEffect(() => {
    if (packages.length > 0 && !selectedId && !activePackage && !activeLoading) {
      const weekly = packages.find((p) => p.durationDays === 7);
      if (weekly) setSelectedId(weekly.id);
    }
  }, [packages.length, activePackage, activeLoading]);

  const handleContinue = () => {
    if (selectedId && !activatePackage.isPending) {
      activatePackage.mutate(selectedId);
    }
  };

  const hasActivePass = !!activePackage;

  return (
    <div className="min-h-screen bg-background">
      {/* Close */}
      <header className="px-6 pt-6 pb-2">
        <div className="max-w-md mx-auto flex justify-end">
          <button
            onClick={() => setLocation("/")}
            className="p-2 -mr-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="px-6 pb-12">
        <div className="max-w-md mx-auto">
          {/* Title */}
          <h1 className="text-2xl font-semibold text-foreground mt-2 mb-2">
            Routed Pass
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">
            Route planning, local recommendations, and real-time
            adjustments for the length of your trip.
          </p>

          {hasActivePass ? (
            /* ── Active pass state ── */
            <div className="rounded-xl border border-primary/20 bg-card p-5">
              <div className="flex items-center gap-2 mb-1">
                <Check className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  Pass active
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Until{" "}
                {new Date(activePackage.endAt).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          ) : (
            /* ── Selection state ── */
            <>
              <div className="space-y-3">
                {packagesLoading ? (
                  [1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border/30 p-5 animate-pulse"
                    >
                      <div className="h-5 bg-muted rounded w-1/3 mb-2" />
                      <div className="h-4 bg-muted rounded w-1/2" />
                    </div>
                  ))
                ) : (
                  sorted.map((pkg) => {
                    const isSelected = selectedId === pkg.id;

                    return (
                      <button
                        key={pkg.id}
                        onClick={() => setSelectedId(pkg.id)}
                        className={`w-full rounded-xl border p-5 text-left transition-colors duration-100 ${
                          isSelected
                            ? "border-foreground/20 bg-secondary/40"
                            : "border-border/40 bg-card hover:border-border/60"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {/* Radio indicator */}
                            <div
                              className={`w-[18px] h-[18px] rounded-full border-[2px] flex items-center justify-center shrink-0 transition-colors ${
                                isSelected
                                  ? "border-primary"
                                  : "border-muted-foreground/25"
                              }`}
                            >
                              {isSelected && (
                                <div className="w-[8px] h-[8px] rounded-full bg-primary" />
                              )}
                            </div>
                            <div>
                              <h3 className="font-medium text-sm text-foreground">
                                {pkg.name}
                              </h3>
                              {pkg.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {pkg.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <span className="font-medium text-sm tabular-nums text-foreground shrink-0 ml-4">
                            {formatPrice(pkg.priceCents)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Continue */}
              <button
                onClick={handleContinue}
                disabled={!selectedId || activatePackage.isPending}
                className="w-full mt-6 py-3 rounded-xl bg-foreground text-background font-medium text-sm transition-opacity disabled:opacity-30"
              >
                {activatePackage.isPending ? "Activating..." : "Continue"}
              </button>

              {/* Coverage note */}
              <p className="text-xs text-muted-foreground text-center mt-4">
                Works in all supported cities.
              </p>
            </>
          )}

          {/* Back */}
          <div className="mt-8 text-center">
            <button
              onClick={() => setLocation("/")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
