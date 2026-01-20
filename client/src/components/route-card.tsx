import { 
  Train, 
  Car, 
  Footprints, 
  Bike, 
  Shuffle,
  Clock,
  DollarSign,
  Heart,
  ChevronRight
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

const modeLabels = {
  transit: "public transit",
  rideshare: "rideshare",
  walk: "walking",
  bike: "cycling",
  mixed: "mixed transport",
};

interface RouteCardProps {
  recommendation: RouteRecommendation;
  onSelect: () => void;
  isLoading?: boolean;
}

export function RouteCard({ recommendation, onSelect, isLoading }: RouteCardProps) {
  const ModeIcon = modeIcons[recommendation.mode];
  const modeLabel = modeLabels[recommendation.mode];
  
  const stressLevel = recommendation.stressScore < 0.3 ? "low stress" : 
                      recommendation.stressScore < 0.6 ? "moderate" : "demanding";
  const stressColor = recommendation.stressScore < 0.3 ? "text-green-600 dark:text-green-400" :
                      recommendation.stressScore < 0.6 ? "text-amber-600 dark:text-amber-400" : "text-red-500";

  return (
    <Card className="overflow-hidden" data-testid="card-route-recommendation">
      <CardContent className="p-0">
        {/* Header with mode */}
        <div className="p-5 pb-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <ModeIcon className="h-5 w-5 text-primary" />
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-medium">{modeLabel}</h3>
                <Badge variant="secondary" className="text-xs">recommended</Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {recommendation.summary}
              </p>
            </div>
          </div>
        </div>
        
        {/* Key metrics - clear and scannable */}
        <div className="px-5 py-3 bg-muted/30 border-y border-border/50 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{recommendation.estimatedDuration} min</span>
          </div>
          
          {recommendation.estimatedCost !== null && (
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {recommendation.estimatedCost === 0 ? "free" : `$${recommendation.estimatedCost}`}
              </span>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-muted-foreground" />
            <span className={`font-medium ${stressColor}`}>{stressLevel}</span>
          </div>
        </div>
        
        {/* AI reasoning */}
        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {recommendation.reasoning}
          </p>
        </div>
        
        {/* Action */}
        <div className="px-5 py-4 border-t border-border/50">
          <Button 
            className="w-full gap-2" 
            size="lg"
            onClick={onSelect}
            disabled={isLoading}
            data-testid="button-start-trip"
          >
            start this route
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
