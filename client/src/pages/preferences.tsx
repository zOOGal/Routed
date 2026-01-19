import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Save, User, Footprints, RefreshCcw, Brain, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PreferenceSlider } from "@/components/preference-slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface UserPreferences {
  walkingTolerance: number;
  transferTolerance: number;
  stressVsSpeedBias: number;
  costSensitivity: number;
}

export default function Preferences() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [preferences, setPreferences] = useState<UserPreferences>({
    walkingTolerance: 3,
    transferTolerance: 3,
    stressVsSpeedBias: 0.7,
    costSensitivity: 3,
  });

  const { data: savedPreferences } = useQuery<UserPreferences>({
    queryKey: ["/api/users/preferences"],
  });

  useEffect(() => {
    if (savedPreferences) {
      setPreferences(savedPreferences);
    }
  }, [savedPreferences]);

  const savePreferences = useMutation({
    mutationFn: async (prefs: UserPreferences) => {
      const response = await apiRequest("PUT", "/api/users/preferences", prefs);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/preferences"] });
      toast({
        title: "Preferences saved",
        description: "Your mobility preferences have been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save preferences. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    savePreferences.mutate(preferences);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="container max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setLocation("/")} className="gap-2" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <h1 className="font-semibold">Preferences</h1>
            <div className="w-16" />
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Footprints className="h-5 w-5 text-primary" />
              Walking Tolerance
            </CardTitle>
            <CardDescription>
              How much are you willing to walk during your journey?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreferenceSlider
              label=""
              value={preferences.walkingTolerance}
              min={1}
              max={5}
              onChange={(v) => setPreferences({ ...preferences, walkingTolerance: v })}
              leftLabel="Minimal walking"
              rightLabel="Love walking"
              testId="slider-walking"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCcw className="h-5 w-5 text-primary" />
              Transfer Tolerance
            </CardTitle>
            <CardDescription>
              How comfortable are you with changing lines or modes?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreferenceSlider
              label=""
              value={preferences.transferTolerance}
              min={1}
              max={5}
              onChange={(v) => setPreferences({ ...preferences, transferTolerance: v })}
              leftLabel="Avoid transfers"
              rightLabel="Transfers are fine"
              testId="slider-transfer"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Stress vs Speed
            </CardTitle>
            <CardDescription>
              Would you prefer a calmer journey or the fastest route?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreferenceSlider
              label=""
              value={Math.round(preferences.stressVsSpeedBias * 10)}
              min={0}
              max={10}
              onChange={(v) => setPreferences({ ...preferences, stressVsSpeedBias: v / 10 })}
              leftLabel="Fastest route"
              rightLabel="Least stress"
              testId="slider-stress"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Cost Sensitivity
            </CardTitle>
            <CardDescription>
              How important is the cost of your journey?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreferenceSlider
              label=""
              value={preferences.costSensitivity}
              min={1}
              max={5}
              onChange={(v) => setPreferences({ ...preferences, costSensitivity: v })}
              leftLabel="Cost doesn't matter"
              rightLabel="Keep it cheap"
              testId="slider-cost"
            />
          </CardContent>
        </Card>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-lg border-t p-4">
        <div className="container max-w-lg mx-auto">
          <Button 
            className="w-full gap-2" 
            size="lg"
            onClick={handleSave}
            disabled={savePreferences.isPending}
            data-testid="button-save-preferences"
          >
            <Save className="h-4 w-4" />
            Save Preferences
          </Button>
        </div>
      </div>
    </div>
  );
}
