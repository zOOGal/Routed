import { 
  Train, 
  Car, 
  Footprints, 
  Bike, 
  Shuffle,
  Clock,
  DollarSign,
  Brain,
  ChevronRight,
  Sparkles
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RouteRecommendation } from "@shared/schema";

const modeIcons = {
  transit: Train,
  rideshare: Car,
  walk: Footprints,
  bike: Bike,
  mixed: Shuffle,
};

const modeColors = {
  transit: "bg-primary",
  rideshare: "bg-accent",
  walk: "bg-chart-3",
  bike: "bg-chart-4",
  mixed: "bg-chart-5",
};

interface RouteCardProps {
  recommendation: RouteRecommendation;
  onSelect: () => void;
  isLoading?: boolean;
}

export function RouteCard({ recommendation, onSelect, isLoading }: RouteCardProps) {
  const ModeIcon = modeIcons[recommendation.mode];
  const modeColor = modeColors[recommendation.mode];
  const stressLabel = recommendation.stressScore < 0.3 ? "Low Stress" : 
                      recommendation.stressScore < 0.6 ? "Moderate" : "Higher Stress";
  const stressColor = recommendation.stressScore < 0.3 ? "text-accent" :
                      recommendation.stressScore < 0.6 ? "text-chart-4" : "text-destructive";

  return (
    <Card className="overflow-hidden hover-elevate active-elevate-2 cursor-pointer" data-testid="card-route-recommendation">
      <CardContent className="p-0">
        <div className="p-5" onClick={onSelect}>
          <div className="flex items-start gap-4">
            <div className={`${modeColor} p-3 rounded-lg`}>
              <ModeIcon className="h-6 w-6 text-white" />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="h-3 w-3" />
                  AI Pick
                </Badge>
              </div>
              
              <h3 className="text-lg font-semibold mb-1 capitalize">
                {recommendation.mode === "mixed" ? "Mixed Transport" : recommendation.mode}
              </h3>
              
              <p className="text-sm text-muted-foreground line-clamp-2">
                {recommendation.summary}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-6 mt-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{recommendation.estimatedDuration} min</span>
            </div>
            
            {recommendation.estimatedCost !== null && (
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {recommendation.estimatedCost === 0 ? "Free" : `$${recommendation.estimatedCost.toFixed(2)}`}
                </span>
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              <span className={`text-sm font-medium ${stressColor}`}>{stressLabel}</span>
            </div>
          </div>
        </div>
        
        <div className="bg-muted/50 px-5 py-4 border-t">
          <div className="flex items-start gap-3">
            <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {recommendation.reasoning}
            </p>
          </div>
        </div>
        
        <div className="px-5 py-3 border-t">
          <Button 
            className="w-full gap-2" 
            onClick={onSelect}
            disabled={isLoading}
            data-testid="button-start-trip"
          >
            Start This Trip
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
