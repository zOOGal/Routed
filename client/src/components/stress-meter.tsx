interface StressMeterProps {
  score: number; // 0-1
  size?: "sm" | "md" | "lg";
}

export function StressMeter({ score, size = "md" }: StressMeterProps) {
  // Inverse: lower stress = more "ease"
  const easePercentage = Math.round((1 - score) * 100);
  const label = score < 0.3 ? "Easy" : score < 0.6 ? "Moderate" : "Demanding";

  const sizes = {
    sm: { wrapper: "gap-3", bar: "h-2", text: "text-xs" },
    md: { wrapper: "gap-3", bar: "h-2.5", text: "text-sm" },
    lg: { wrapper: "gap-4", bar: "h-3", text: "text-base" },
  };

  const s = sizes[size];

  return (
    <div className={`flex items-center ${s.wrapper}`}>
      <span className={`${s.text} font-medium text-muted-foreground uppercase tracking-wider`}>
        Ease
      </span>
      <div className="flex-1">
        <div className={`w-full bg-secondary rounded-full overflow-hidden ${s.bar}`}>
          <div
            className={`${s.bar} bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500`}
            style={{ width: `${easePercentage}%` }}
          />
        </div>
      </div>
      <span className={`${s.text} font-medium text-foreground min-w-[70px] text-right`}>
        {label}
      </span>
    </div>
  );
}
