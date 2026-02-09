/**
 * PROFILE DEBUG ACCORDION (Dev Only)
 *
 * Shows user's learned preferences and recent events.
 * Only visible in development mode.
 */

import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  History,
  RefreshCw,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UserProfilePrefs {
  walkingToleranceMin: number;
  walkingToleranceMax: number;
  transferTolerance: number;
  calmQuickBias: number;
  costComfortBias: number;
  outdoorBias: number;
  replanSensitivity: number;
}

interface ProfileEvent {
  id: string;
  type: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

interface ProfileData {
  prefs: UserProfilePrefs;
  totalTrips: number;
  cityFamiliarity: Record<string, number>;
  events: ProfileEvent[];
}

function BiasIndicator({ value, label }: { value: number; label: string }) {
  // Value is -1 to +1
  const percent = ((value + 1) / 2) * 100;
  const isPositive = value > 0.1;
  const isNegative = value < -0.1;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground w-24">{label}</span>
      <div className="flex items-center gap-2 flex-1">
        <div className="h-1.5 flex-1 bg-secondary rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              isPositive
                ? "bg-blue-500"
                : isNegative
                  ? "bg-amber-500"
                  : "bg-muted-foreground"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="font-mono w-12 text-right">
          {value > 0 ? "+" : ""}
          {value.toFixed(2)}
        </span>
        {isPositive && <TrendingUp className="h-3 w-3 text-blue-500" />}
        {isNegative && <TrendingDown className="h-3 w-3 text-amber-500" />}
        {!isPositive && !isNegative && <Minus className="h-3 w-3 text-muted-foreground" />}
      </div>
    </div>
  );
}

function ToleranceIndicator({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = (value / max) * 100;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground w-24">{label}</span>
      <div className="flex items-center gap-2 flex-1">
        <div className="h-1.5 flex-1 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
        </div>
        <span className="font-mono w-12 text-right">{value.toFixed(0)}</span>
      </div>
    </div>
  );
}

export function ProfileDebug() {
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);

  // Only show in development
  const isDev = import.meta.env.DEV;
  if (!isDev) return null;

  const fetchProfile = async () => {
    setLoading(true);
    try {
      // Fetch learned preferences
      const prefsRes = await apiRequest("GET", "/api/user/learned-preferences");
      const prefs = await prefsRes.json();

      // Fetch recent events
      const eventsRes = await apiRequest("GET", "/api/events?limit=10");
      const events = await eventsRes.json();

      // Convert old LearnedPreferences format to new format
      const profilePrefs: UserProfilePrefs = {
        walkingToleranceMin: prefs.walkingToleranceMin || 10,
        walkingToleranceMax: 30, // Not in old format, use default
        transferTolerance: (prefs.transferTolerance || 3) / 5, // Convert 1-5 to 0-1
        calmQuickBias: ((prefs.calmQuickBias || 0.5) - 0.5) * 2, // Convert 0-1 to -1 to +1
        costComfortBias: ((prefs.saveSpendBias || 0.3) - 0.5) * 2,
        outdoorBias: 0, // Not in old format
        replanSensitivity: prefs.replanSensitivity || 0.5,
      };

      setProfile({
        prefs: profilePrefs,
        totalTrips: events.length,
        cityFamiliarity: prefs.familiarityByCity || {},
        events: events.slice(0, 10),
      });
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && !profile) {
      fetchProfile();
    }
  }, [isOpen]);

  return (
    <div className="border-t border-border/30 mt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-2 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5" />
          Profile Debug
        </span>
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {isOpen && (
        <div className="pb-4 px-1 space-y-4 text-xs">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {profile && !loading && (
            <>
              {/* Learned Biases */}
              <div className="space-y-2">
                <div className="font-medium text-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Learned Biases
                </div>
                <div className="space-y-1.5 bg-secondary/30 rounded-lg p-3">
                  <BiasIndicator
                    value={profile.prefs.calmQuickBias}
                    label="Calm ↔ Quick"
                  />
                  <BiasIndicator
                    value={profile.prefs.costComfortBias}
                    label="Cost ↔ Comfort"
                  />
                  <BiasIndicator
                    value={profile.prefs.outdoorBias}
                    label="Indoor ↔ Outdoor"
                  />
                  <div className="border-t border-border/30 my-2" />
                  <ToleranceIndicator
                    value={profile.prefs.walkingToleranceMin}
                    max={60}
                    label="Walk Min"
                  />
                  <ToleranceIndicator
                    value={profile.prefs.walkingToleranceMax}
                    max={60}
                    label="Walk Max"
                  />
                  <ToleranceIndicator
                    value={profile.prefs.transferTolerance * 100}
                    max={100}
                    label="Transfer %"
                  />
                  <ToleranceIndicator
                    value={profile.prefs.replanSensitivity * 100}
                    max={100}
                    label="Replan %"
                  />
                </div>
              </div>

              {/* City Familiarity */}
              {Object.keys(profile.cityFamiliarity).length > 0 && (
                <div className="space-y-2">
                  <div className="font-medium text-foreground">City Familiarity</div>
                  <div className="bg-secondary/30 rounded-lg p-3 space-y-1.5">
                    {Object.entries(profile.cityFamiliarity).map(([city, score]) => (
                      <ToleranceIndicator
                        key={city}
                        value={score * 100}
                        max={100}
                        label={city}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Events */}
              <div className="space-y-2">
                <div className="font-medium text-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Recent Events ({profile.events.length})
                </div>
                <div className="bg-secondary/30 rounded-lg p-3 space-y-1.5 max-h-40 overflow-y-auto">
                  {profile.events.length === 0 ? (
                    <div className="text-muted-foreground text-center py-2">No events yet</div>
                  ) : (
                    profile.events.map((event) => (
                      <div key={event.id} className="flex items-center justify-between">
                        <span className="font-mono text-foreground/80">{event.type}</span>
                        <span className="text-muted-foreground">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Refresh Button */}
              <button
                onClick={fetchProfile}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
