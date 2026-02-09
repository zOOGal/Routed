import { Info, Clock, Cloud, MapPin, History } from "lucide-react";
import type { DepthLayerOutput } from "@shared/schema";

interface DepthInsightsProps {
  depthLayer: DepthLayerOutput;
  showMemoryCallback?: boolean;
}

export function DepthInsights({ depthLayer, showMemoryCallback = true }: DepthInsightsProps) {
  const { contextualInsights, memoryCallbackLine } = depthLayer;

  if (contextualInsights.length === 0 && !memoryCallbackLine) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Memory callback - subtle, only if present */}
      {showMemoryCallback && memoryCallbackLine && (
        <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-xl border border-border/30">
          <History className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground italic">{memoryCallbackLine}</p>
        </div>
      )}

      {/* Contextual insights */}
      {contextualInsights.length > 0 && (
        <div className="space-y-2">
          {contextualInsights.map((insight, index) => (
            <div
              key={index}
              className="flex items-start gap-2 text-sm text-foreground/80"
            >
              <InsightIcon insight={insight} />
              <span>{insight}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InsightIcon({ insight }: { insight: string }) {
  const lowerInsight = insight.toLowerCase();

  // Match insight to appropriate icon - using muted, uniform colors for minimalism
  if (
    lowerInsight.includes("closed") ||
    lowerInsight.includes("opens") ||
    lowerInsight.includes("reservation") ||
    lowerInsight.includes("ticket")
  ) {
    return <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />;
  }

  if (
    lowerInsight.includes("rain") ||
    lowerInsight.includes("weather") ||
    lowerInsight.includes("cold") ||
    lowerInsight.includes("hot") ||
    lowerInsight.includes("temperature")
  ) {
    return <Cloud className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />;
  }

  if (
    lowerInsight.includes("rush") ||
    lowerInsight.includes("crowded") ||
    lowerInsight.includes("night") ||
    lowerInsight.includes("service")
  ) {
    return <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />;
  }

  return <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />;
}

interface ResponsibilityLineProps {
  text: string;
  className?: string;
}

export function ResponsibilityLine({ text, className = "" }: ResponsibilityLineProps) {
  return (
    <p className={`text-xs text-muted-foreground/70 ${className}`}>
      {text}
    </p>
  );
}

interface TripFramingProps {
  framingLine: string;
  className?: string;
}

export function TripFraming({ framingLine, className = "" }: TripFramingProps) {
  return (
    <p className={`text-sm text-foreground/80 ${className}`}>
      {framingLine}
    </p>
  );
}

interface AgentPresenceProps {
  presenceLine: string;
  className?: string;
}

export function AgentPresence({ presenceLine, className = "" }: AgentPresenceProps) {
  return (
    <p className={`text-xs text-muted-foreground italic ${className}`}>
      {presenceLine}
    </p>
  );
}
