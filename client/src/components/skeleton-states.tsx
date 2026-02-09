import { Card, CardContent, CardHeader } from "@/components/ui/card";

function SkeletonBar({ className }: { className?: string }) {
  return <div className={`shimmer rounded ${className}`} />;
}

export function RecommendationSkeleton() {
  return (
    <Card className="animate-scale-in">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <SkeletonBar className="h-5 w-32" />
          <SkeletonBar className="h-6 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Route summary */}
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-1">
            <SkeletonBar className="w-3 h-3 rounded-full" />
            <SkeletonBar className="w-0.5 h-10" />
            <SkeletonBar className="w-4 h-4" />
          </div>
          <div className="flex-1 space-y-4">
            <div className="space-y-1">
              <SkeletonBar className="h-3 w-12" />
              <SkeletonBar className="h-4 w-48" />
            </div>
            <div className="space-y-1">
              <SkeletonBar className="h-3 w-8" />
              <SkeletonBar className="h-4 w-40" />
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="pt-4 border-t flex items-center gap-6">
          <div className="flex items-center gap-2">
            <SkeletonBar className="h-4 w-4" />
            <SkeletonBar className="h-4 w-16" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBar className="h-4 w-4" />
            <SkeletonBar className="h-4 w-12" />
          </div>
          <div className="flex-1">
            <SkeletonBar className="h-2 w-full rounded-full" />
          </div>
        </div>

        {/* Insights placeholder */}
        <div className="space-y-2 pt-2">
          <SkeletonBar className="h-3 w-3/4" />
          <SkeletonBar className="h-3 w-1/2" />
        </div>
      </CardContent>
    </Card>
  );
}

export function TripDetailsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header card */}
      <Card className="animate-slide-up">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-1">
              <SkeletonBar className="w-3 h-3 rounded-full" />
              <SkeletonBar className="w-0.5 h-10" />
              <SkeletonBar className="w-4 h-4" />
            </div>
            <div className="flex-1 space-y-4">
              <div className="space-y-1">
                <SkeletonBar className="h-3 w-10" />
                <SkeletonBar className="h-4 w-32" />
              </div>
              <div className="space-y-1">
                <SkeletonBar className="h-3 w-6" />
                <SkeletonBar className="h-4 w-40" />
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t flex items-center gap-6">
            <SkeletonBar className="h-4 w-20" />
            <SkeletonBar className="flex-1 h-2 rounded-full" />
          </div>
        </CardContent>
      </Card>

      {/* Steps skeleton */}
      <Card className="animate-slide-up stagger-1" style={{ opacity: 0 }}>
        <CardHeader className="pb-4">
          <SkeletonBar className="h-5 w-28" />
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="flex flex-col items-center">
                <SkeletonBar className="w-10 h-10 rounded-full" />
                <SkeletonBar className="w-0.5 flex-1 mt-2" />
              </div>
              <div className="flex-1 pb-4 space-y-2">
                <SkeletonBar className="h-4 w-24" />
                <SkeletonBar className="h-3 w-48" />
                <SkeletonBar className="h-3 w-16" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function HistoryItemSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <SkeletonBar className="w-8 h-8 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <SkeletonBar className="h-4 w-32" />
              <SkeletonBar className="h-5 w-16 rounded-full" />
            </div>
            <SkeletonBar className="h-3 w-48" />
            <SkeletonBar className="h-3 w-24" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function HistoryListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`animate-slide-up stagger-${i}`}
          style={{ opacity: 0 }}
        >
          <HistoryItemSkeleton />
        </div>
      ))}
    </div>
  );
}
