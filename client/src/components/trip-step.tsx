import { 
  Footprints, 
  Train, 
  Car, 
  Clock, 
  ArrowRight,
  ExternalLink,
  Check,
  Circle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RouteStep } from "@shared/schema";

const stepIcons = {
  walk: Footprints,
  transit: Train,
  rideshare: Car,
  wait: Clock,
  transfer: ArrowRight,
};

interface TripStepProps {
  step: RouteStep;
  index: number;
  isActive: boolean;
  isCompleted: boolean;
  onComplete: () => void;
}

export function TripStep({ step, index, isActive, isCompleted, onComplete }: TripStepProps) {
  const StepIcon = stepIcons[step.type] || Circle;

  return (
    <div 
      className={`relative flex gap-4 pb-6 ${index === 0 ? "" : ""}`}
      data-testid={`trip-step-${index}`}
    >
      <div className="flex flex-col items-center">
        <div 
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
            isCompleted 
              ? "bg-accent text-accent-foreground" 
              : isActive 
                ? "bg-primary text-primary-foreground ring-4 ring-primary/20" 
                : "bg-muted text-muted-foreground"
          }`}
        >
          {isCompleted ? (
            <Check className="h-5 w-5" />
          ) : (
            <StepIcon className="h-5 w-5" />
          )}
        </div>
        <div className={`w-0.5 flex-1 mt-2 ${
          isCompleted ? "bg-accent" : "bg-border"
        }`} />
      </div>
      
      <div className={`flex-1 pb-4 ${isActive ? "" : "opacity-60"}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="font-medium capitalize mb-1">
              {step.type === "transit" && step.line ? `Take ${step.line}` : step.type}
            </h4>
            <p className="text-sm text-muted-foreground">
              {step.instruction}
            </p>
            
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {step.duration} min
              </span>
              {step.distance && (
                <span>{Math.round(step.distance)} m</span>
              )}
              {step.stopsCount && (
                <span>{step.stopsCount} stops</span>
              )}
            </div>
          </div>
          
          {isActive && (
            <div className="flex gap-2">
              {step.deepLink && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="gap-1"
                  onClick={() => window.open(step.deepLink, "_blank")}
                  data-testid={`button-open-app-${index}`}
                >
                  <ExternalLink className="h-3 w-3" />
                  Open App
                </Button>
              )}
              <Button 
                size="sm" 
                onClick={onComplete}
                data-testid={`button-complete-step-${index}`}
              >
                Done
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
