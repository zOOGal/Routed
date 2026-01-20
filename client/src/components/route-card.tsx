import { 
  Train, 
  Car, 
  Footprints, 
  Bike, 
  Shuffle,
  Clock,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RouteRecommendation } from "@shared/schema";

const modeIcons = {
  transit: Train,
  rideshare: Car,
  walk: Footprints,
  bike: Bike,
  mixed: Shuffle,
};

interface RouteCardProps {
  recommendation: RouteRecommendation;
  onSelect: () => void;
  isLoading?: boolean;
}

export function RouteCard({ recommendation, onSelect, isLoading }: RouteCardProps) {
  const ModeIcon = modeIcons[recommendation.mode];
  const stressLabel = recommendation.stressScore < 0.3 ? "calm journey" : 
                      recommendation.stressScore < 0.6 ? "moderate pace" : "more demanding";

  return (
    <div 
      className="rounded-2xl bg-card/80 backdrop-blur-sm border border-border/40 overflow-hidden hover-elevate cursor-pointer transition-all duration-300"
      style={{ borderRadius: '1.25rem 1rem 1.25rem 1rem' }}
      data-testid="card-route-recommendation"
    >
      {/* Main content */}
      <div className="p-6" onClick={onSelect}>
        <div className="flex items-start gap-5">
          {/* Mode icon - organic shape */}
          <div 
            className="p-3.5 rounded-xl bg-primary/10 text-primary"
            style={{ borderRadius: '0.875rem 0.75rem 0.875rem 0.75rem' }}
          >
            <ModeIcon className="h-5 w-5" />
          </div>
          
          <div className="flex-1 min-w-0 space-y-3">
            {/* Mode label - humble lowercase typography */}
            <div>
              <h3 className="text-lg font-normal lowercase tracking-tight">
                {recommendation.mode === "mixed" ? "mixed transport" : recommendation.mode}
              </h3>
              <p className="text-sm text-muted-foreground/70 mt-1 leading-relaxed">
                {recommendation.summary}
              </p>
            </div>
            
            {/* Stats - gentle, muted */}
            <div className="flex items-center gap-5 text-sm text-muted-foreground/60 pt-1">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>{recommendation.estimatedDuration} min</span>
              </div>
              
              {recommendation.estimatedCost !== null && recommendation.estimatedCost > 0 && (
                <span>
                  ${recommendation.estimatedCost.toFixed(0)}
                </span>
              )}
              
              <span className="opacity-70">{stressLabel}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Reasoning section - Yūgen (subtle depth) */}
      <div className="px-6 py-5 border-t border-border/30 bg-muted/20">
        <p className="text-sm text-muted-foreground/70 leading-relaxed italic">
          "{recommendation.reasoning}"
        </p>
      </div>
      
      {/* Action - calm invitation */}
      <div className="px-6 py-4 border-t border-border/30">
        <Button 
          className="w-full py-5 gap-2 font-normal rounded-xl transition-all duration-300" 
          onClick={onSelect}
          disabled={isLoading}
          data-testid="button-start-trip"
        >
          begin journey
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
