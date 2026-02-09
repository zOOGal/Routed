import { ChevronLeft } from "lucide-react";

interface HelpAboutSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpAboutSheet({ isOpen, onClose }: HelpAboutSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background animate-slide-in-right">
      {/* iOS-style navigation bar */}
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex items-center justify-between h-14 px-4">
          <button
            onClick={onClose}
            className="flex items-center gap-0.5 py-2 -ml-2 text-primary active:opacity-50 transition-opacity"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
            <span className="text-[17px]">Back</span>
          </button>
          <h1 className="text-[17px] font-semibold absolute left-1/2 -translate-x-1/2">
            About
          </h1>
          <div className="w-16" /> {/* Spacer for centering */}
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto h-[calc(100vh-56px)] px-5 py-6 space-y-7 pb-24">
        {/* What Routed does */}
        <section>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">What Routed does</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            Routed helps you get from one place to another without thinking through every option yourself.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            You tell it where you're going. It chooses a route — considering transit, walking, and rideshare — and explains why. One recommendation, not a list of choices.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            The goal is less deliberation, not more information.
          </p>
        </section>

        {/* How decisions are made */}
        <section>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">How decisions are made</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            Routed considers practical factors: travel time, transfers, walking distance, weather, and time of day. It weighs these based on what kind of trip you're taking.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            It does not always pick the fastest route. It picks the route it believes will cause you the least friction.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            Sometimes it will be wrong. When that happens, it adjusts.
          </p>
        </section>

        {/* Preferences and memory */}
        <section>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">Preferences and memory</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            Routed learns quietly from how you travel — not from surveys or settings.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            Over time, it notices patterns: how much walking you tend to complete, whether you prefer direct routes, how you behave in different cities. It uses this to make slightly better decisions on future trips.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            It does not track where you go. It does not build a profile of your interests. The memory exists only to reduce how much you need to think.
          </p>
        </section>

        {/* Passes and coverage */}
        <section>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">Passes and coverage</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            Routed offers an optional pass that covers certain transit recommendations at no additional cost per trip.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            In this version, pass functionality is simulated. No real payment is processed, and coverage indicators are for demonstration purposes.
          </p>
        </section>

        {/* What Routed is not */}
        <section>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">What Routed is not</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            Routed is not a maps app. It does not show you every possible route or let you compare options side by side.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            It is not a rideshare app. It may recommend rideshare, but it does not operate vehicles or set prices.
          </p>
          <p className="text-[15px] text-muted-foreground leading-relaxed mt-3">
            It is a transportation tool. It makes one decision and explains it. That's all.
          </p>
        </section>

        {/* Feedback */}
        <section>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">Feedback</h3>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            If something feels wrong — a bad recommendation, confusing wording, unexpected behavior — that's useful to know.
          </p>
        </section>

        {/* Footer */}
        <div className="pt-6 border-t border-border/30">
          <p className="text-[13px] text-muted-foreground/60 leading-relaxed">
            Routed is a prototype built for the Gemini API Developer Competition. Some features are simulated. Core routing data is provided by Google Maps.
          </p>
        </div>
      </div>
    </div>
  );
}
