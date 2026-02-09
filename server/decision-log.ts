/**
 * DECISION LOG — Audit trail for route decisions
 *
 * This module provides structured logging for debugging
 * and validating that the decision engine is honest.
 */

export interface DecisionLog {
  timestamp: string;
  requestId: string;

  // Inputs
  inputs: {
    origin: string;
    destination: string;
    cityId: string;
    intent: string;
    userNote?: string;
    calmVsFast: number;
    economyVsComfort: number;
    unfamiliarWithCity: boolean;
  };

  // Constraints derived from inputs
  constraints: {
    intentWeights: { calm: number; fast: number; comfort: number };
    noteModifiers: {
      walkingPenalty: number;
      rushPenalty: number;
      comfortBonus: number;
      keywords: string[];
    };
    finalWeights: { calm: number; fast: number; comfort: number };
    modeFiltering: string | null; // e.g., "driving excluded due to economy preference"
  };

  // Candidates
  candidates: {
    mode: string;
    archetype: string;
    scores: { calm: number; fast: number; comfort: number };
    finalScore: number;
    durationMinutes: number;
    walkingMinutes: number;
    transferCount: number;
  }[];

  // Decision
  decision: {
    selectedMode: string;
    selectedArchetype: string;
    wasOnlyOption: boolean;
    primaryReason: string;
    intentInfluence: string | null;
    noteInfluence: string | null;
    tradeoffs: string[];
  };

  // Flags
  flags: {
    googleMapsReturned: number; // number of routes
    usedFallback: boolean;
    llmCalled: boolean;
    llmFailed: boolean;
    locationMismatchDetected: boolean;
    ridehailQuotesFetched?: number; // number of ridehail quotes
    ridehailOptionsIncluded?: number; // number of ridehail options in candidates
  };

  // Debug info
  debug?: {
    cheapestRidehailProvider?: string;
    ridehailPriceLabel?: string;
    ridehailSelectionReason?: string;
    [key: string]: any;
  };

  // Warnings
  warnings: string[];
}

const DEBUG_MODE = process.env.NODE_ENV === "development";
const logs: DecisionLog[] = [];

export function createDecisionLog(requestId: string): DecisionLog {
  return {
    timestamp: new Date().toISOString(),
    requestId,
    inputs: {
      origin: "",
      destination: "",
      cityId: "",
      intent: "",
      calmVsFast: 50,
      economyVsComfort: 50,
      unfamiliarWithCity: false,
    },
    constraints: {
      intentWeights: { calm: 0, fast: 0, comfort: 0 },
      noteModifiers: {
        walkingPenalty: 0,
        rushPenalty: 0,
        comfortBonus: 0,
        keywords: [],
      },
      finalWeights: { calm: 0, fast: 0, comfort: 0 },
      modeFiltering: null,
    },
    candidates: [],
    decision: {
      selectedMode: "",
      selectedArchetype: "",
      wasOnlyOption: false,
      primaryReason: "",
      intentInfluence: null,
      noteInfluence: null,
      tradeoffs: [],
    },
    flags: {
      googleMapsReturned: 0,
      usedFallback: false,
      llmCalled: false,
      llmFailed: false,
      locationMismatchDetected: false,
    },
    warnings: [],
  };
}

export function logDecision(log: DecisionLog): void {
  if (DEBUG_MODE) {
    console.log("\n========== DECISION LOG ==========");
    console.log("Request ID:", log.requestId);
    console.log("Timestamp:", log.timestamp);
    console.log("\n--- INPUTS ---");
    console.log(JSON.stringify(log.inputs, null, 2));
    console.log("\n--- CONSTRAINTS ---");
    console.log(JSON.stringify(log.constraints, null, 2));
    console.log("\n--- CANDIDATES ---");
    log.candidates.forEach((c, i) => {
      console.log(`  [${i + 1}] ${c.mode} (${c.archetype}) → score: ${c.finalScore.toFixed(2)}`);
      console.log(`      duration: ${c.durationMinutes}min, walking: ${c.walkingMinutes}min, transfers: ${c.transferCount}`);
    });
    console.log("\n--- DECISION ---");
    console.log(`  Selected: ${log.decision.selectedMode} (${log.decision.selectedArchetype})`);
    console.log(`  Reason: ${log.decision.primaryReason}`);
    if (log.decision.intentInfluence) {
      console.log(`  Intent influence: ${log.decision.intentInfluence}`);
    }
    if (log.decision.noteInfluence) {
      console.log(`  Note influence: ${log.decision.noteInfluence}`);
    }
    console.log("\n--- FLAGS ---");
    console.log(`  Google Maps routes: ${log.flags.googleMapsReturned}`);
    console.log(`  Used fallback: ${log.flags.usedFallback}`);
    console.log(`  LLM called: ${log.flags.llmCalled}`);
    console.log(`  LLM failed: ${log.flags.llmFailed}`);
    if (log.warnings.length > 0) {
      console.log("\n--- WARNINGS ---");
      log.warnings.forEach(w => console.log(`  ⚠️ ${w}`));
    }
    console.log("==================================\n");
  }

  // Keep last 100 logs in memory for debugging API
  logs.push(log);
  if (logs.length > 100) {
    logs.shift();
  }
}

export function getRecentLogs(): DecisionLog[] {
  return logs.slice(-20);
}

export function validateDecisionHonesty(log: DecisionLog): string[] {
  const violations: string[] = [];

  // Rule 1: If only one candidate, don't claim intent influenced the decision
  if (log.decision.wasOnlyOption && log.decision.intentInfluence) {
    violations.push("HONESTY: Claimed intent influenced decision, but there was only one option");
  }

  // Rule 2: If used fallback, don't claim we "considered" anything
  if (log.flags.usedFallback && log.candidates.length === 0) {
    violations.push("HONESTY: Used fallback but claimed to have candidates");
  }

  // Rule 3: If note keywords were empty, don't claim note influenced decision
  if (log.constraints.noteModifiers.keywords.length === 0 && log.decision.noteInfluence) {
    violations.push("HONESTY: Claimed note influenced decision, but no keywords detected");
  }

  // Rule 4: If archetype is "calm" but route has many transfers, that's dishonest
  if (log.decision.selectedArchetype === "calm") {
    const selected = log.candidates.find(c => c.mode === log.decision.selectedMode);
    if (selected && selected.transferCount > 2) {
      violations.push("HONESTY: Called route 'calm' but it has more than 2 transfers");
    }
  }

  return violations;
}
