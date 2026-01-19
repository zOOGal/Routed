import { Brain } from "lucide-react";

interface StressMeterProps {
  score: number; // 0-1
  size?: "sm" | "md" | "lg";
}

export function StressMeter({ score, size = "md" }: StressMeterProps) {
  const percentage = Math.round(score * 100);
  const label = score < 0.3 ? "Low Stress" : score < 0.6 ? "Moderate" : "High Stress";
  const color = score < 0.3 ? "bg-accent" : score < 0.6 ? "bg-chart-4" : "bg-destructive";
  const textColor = score < 0.3 ? "text-accent" : score < 0.6 ? "text-chart-4" : "text-destructive";

  const sizes = {
    sm: { wrapper: "gap-2", bar: "h-1.5", text: "text-xs" },
    md: { wrapper: "gap-3", bar: "h-2", text: "text-sm" },
    lg: { wrapper: "gap-4", bar: "h-3", text: "text-base" },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center ${s.wrapper}`}>
      <Brain className={`h-4 w-4 ${textColor}`} />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className={`${s.text} text-muted-foreground`}>Stress Level</span>
          <span className={`${s.text} font-medium ${textColor}`}>{label}</span>
        </div>
        <div className={`w-full bg-muted rounded-full overflow-hidden ${s.bar}`}>
          <div 
            className={`${s.bar} ${color} rounded-full transition-all duration-500`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
