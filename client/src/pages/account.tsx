/**
 * ACCOUNT PAGE
 *
 * Full-page account management with native app feel.
 * Calm, minimal, warm design language.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft,
  User,
  Ticket,
  Compass,
  MapPin,
  Footprints,
  Mail,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { useCity } from "@/lib/city-context";
import type { UserPackage } from "@shared/schema";

// Types
interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

interface UserProfile {
  userId: string;
  prefs: {
    walkingToleranceMin: number;
    walkingToleranceMax: number;
    transferTolerance: number;
    calmQuickBias: number;
    costComfortBias: number;
    outdoorBias: number;
  };
  cityFamiliarity: Record<string, number>;
  totalTrips: number;
}

// Preference bar component
function PreferenceBar({
  value,
  leftLabel,
  rightLabel,
}: {
  value: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const percent = ((value + 1) / 2) * 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="h-1 bg-border/50 rounded-full overflow-hidden">
        <div
          className="h-full bg-foreground/20 rounded-full transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// Section card component
function Section({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card rounded-2xl border border-border/30 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

// Auth form component (inline)
function AuthForm({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Login failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      onSuccess();
    },
    onError: (err: Error) => setError(err.message),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Registration failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      onSuccess();
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "login") {
      loginMutation.mutate();
    } else {
      registerMutation.mutate();
    }
  };

  const isLoading = loginMutation.isPending || registerMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-4 border-b border-border/30 mb-6">
        <button
          type="button"
          onClick={() => { setMode("login"); setError(null); }}
          className={`pb-3 text-sm font-medium transition-colors relative ${
            mode === "login"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Sign in
          {mode === "login" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />
          )}
        </button>
        <button
          type="button"
          onClick={() => { setMode("register"); setError(null); }}
          className={`pb-3 text-sm font-medium transition-colors relative ${
            mode === "register"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Create account
          {mode === "register" && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />
          )}
        </button>
      </div>

      {/* Name field (register only) */}
      {mode === "register" && (
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Name</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full h-12 pl-11 pr-4 bg-secondary/30 border border-border/30 rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
            />
          </div>
        </div>
      )}

      {/* Email field */}
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">Email</label>
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full h-12 pl-11 pr-4 bg-secondary/30 border border-border/30 rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
          />
        </div>
      </div>

      {/* Password field */}
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">Password</label>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
            required
            minLength={mode === "register" ? 6 : undefined}
            className="w-full h-12 pl-11 pr-11 bg-secondary/30 border border-border/30 rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Submit */}
      <Button
        type="submit"
        className="w-full h-12 rounded-xl font-medium mt-2"
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : mode === "login" ? (
          "Sign in"
        ) : (
          "Create account"
        )}
      </Button>
    </form>
  );
}

export default function AccountPage() {
  const [, setLocation] = useLocation();
  const { cityId } = useCity();

  // Queries
  const { data: authData, isLoading: authLoading } = useQuery<{
    authenticated: boolean;
    user: AuthUser | null;
  }>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      return response.json();
    },
  });

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    queryFn: async () => {
      const response = await fetch("/api/user/profile", {
        credentials: "include",
        cache: "no-store",
      });
      return response.json();
    },
  });

  const { data: activePackage } = useQuery<UserPackage | null>({
    queryKey: ["/api/user/active-package", cityId],
    queryFn: async () => {
      const response = await fetch(`/api/user/active-package?cityId=${cityId}`);
      return response.json();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const cityEntries = Object.entries(profile?.cityFamiliarity ?? {});

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-lg border-b border-border/30">
        <div className="px-6 py-4">
          <div className="max-w-md mx-auto flex items-center gap-4">
            <button
              onClick={() => setLocation("/")}
              className="p-2 -ml-2 rounded-xl hover:bg-secondary/50 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-semibold">Account</h1>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-6 pb-20">
        <div className="max-w-md mx-auto space-y-4">

          {/* Account Section */}
          <Section>
            <div className="p-5">
              {authLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : authData?.authenticated ? (
                <div className="space-y-4">
                  {/* User info */}
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        {authData.user?.displayName}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {authData.user?.email}
                      </p>
                    </div>
                  </div>

                  {/* Sign out button */}
                  <button
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                    className="w-full flex items-center justify-between p-4 -mx-1 rounded-xl hover:bg-secondary/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <LogOut className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Sign out</span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                  </button>
                </div>
              ) : (
                <AuthForm onSuccess={() => {}} />
              )}
            </div>
          </Section>

          {/* Transit Pass Section */}
          <Section>
            <button
              onClick={() => setLocation("/packages")}
              className="w-full p-5 text-left"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    activePackage ? "bg-primary/10" : "bg-secondary/50"
                  }`}>
                    <Ticket className={`h-5 w-5 ${
                      activePackage ? "text-primary" : "text-muted-foreground"
                    }`} />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Transit Pass</p>
                    <p className="text-sm text-muted-foreground">
                      {activePackage
                        ? `Active · Expires ${new Date(activePackage.endAt).toLocaleDateString()}`
                        : "No active pass"}
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
              </div>
            </button>
          </Section>

          {/* Stats Section */}
          <Section className="p-5">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-10 h-10 rounded-xl bg-secondary/50 flex items-center justify-center">
                <Compass className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {profile?.totalTrips ?? 0}
                </p>
                <p className="text-sm text-muted-foreground">
                  {(profile?.totalTrips ?? 0) === 1 ? "trip completed" : "trips completed"}
                </p>
              </div>
            </div>

            {/* Cities */}
            {cityEntries.length > 0 && (
              <div className="pt-4 border-t border-border/30">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Cities explored</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {cityEntries.map(([cityName, familiarity]) => (
                    <span
                      key={cityName}
                      className="px-3 py-1.5 bg-secondary/40 rounded-lg text-xs font-medium capitalize"
                    >
                      {cityName}
                      <span className="ml-1.5 text-muted-foreground">
                        {Math.round(familiarity * 100)}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Learned Preferences Section */}
          <Section className="p-5">
            <div className="flex items-center gap-2 mb-5">
              <Footprints className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Learned preferences</span>
            </div>

            <div className="space-y-5">
              <PreferenceBar
                value={profile?.prefs.calmQuickBias ?? 0}
                leftLabel="Calm"
                rightLabel="Quick"
              />
              <PreferenceBar
                value={profile?.prefs.costComfortBias ?? 0}
                leftLabel="Budget"
                rightLabel="Comfort"
              />
              <PreferenceBar
                value={profile?.prefs.outdoorBias ?? 0}
                leftLabel="Indoor"
                rightLabel="Outdoor"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-border/30">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Walking</p>
                <p className="text-sm font-medium">
                  {profile?.prefs.walkingToleranceMin ?? 15}–{profile?.prefs.walkingToleranceMax ?? 30} min
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Transfers</p>
                <p className="text-sm font-medium">
                  {(profile?.prefs.transferTolerance ?? 0.5) < 0.3
                    ? "Minimize"
                    : (profile?.prefs.transferTolerance ?? 0.5) > 0.7
                    ? "Don't mind"
                    : "Moderate"}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground/70 mt-5 pt-4 border-t border-border/30">
              These preferences update automatically as you travel.
            </p>
          </Section>

        </div>
      </main>
    </div>
  );
}
