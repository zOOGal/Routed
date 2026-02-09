/**
 * AUTH FORMS
 *
 * Login and registration forms for the profile sheet.
 * Calm, minimal design matching Routed's aesthetic.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, User, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

interface AuthFormsProps {
  onSuccess: (user: AuthUser) => void;
}

export function AuthForms({ onSuccess }: AuthFormsProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      onSuccess(data.user);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
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
      if (!response.ok) {
        throw new Error(data.error || "Registration failed");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
      onSuccess(data.user);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
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
    <div className="space-y-6">
      {/* Tab toggle */}
      <div className="flex bg-secondary/50 rounded-xl p-1 border border-border/30">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
          }}
          className={`flex-1 py-2.5 text-sm rounded-lg transition-all duration-200 ${
            mode === "login"
              ? "bg-card text-foreground shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setError(null);
          }}
          className={`flex-1 py-2.5 text-sm rounded-lg transition-all duration-200 ${
            mode === "register"
              ? "bg-card text-foreground shadow-sm font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Display name (register only) */}
        {mode === "register" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
              Name
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="routed-input w-full pl-10"
              />
            </div>
          </div>
        )}

        {/* Email */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
            Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="routed-input w-full pl-10"
              required
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
              className="routed-input w-full pl-10 pr-10"
              required
              minLength={mode === "register" ? 6 : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-xl">
            {error}
          </div>
        )}

        {/* Submit button */}
        <Button
          type="submit"
          className="w-full py-5 rounded-xl font-medium"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {mode === "login" ? "Signing in..." : "Creating account..."}
            </>
          ) : mode === "login" ? (
            "Sign in"
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      {/* Info note */}
      <p className="text-xs text-muted-foreground/70 text-center">
        {mode === "login"
          ? "Your preferences will be synced across devices."
          : "Your travel preferences will be saved to your account."}
      </p>
    </div>
  );
}
