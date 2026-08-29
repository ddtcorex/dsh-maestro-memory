/**
 * health-score.ts — 5-dim scoring (S/R/J/C/Safety) per memory_score.md
 * Composite = min*0.4 + mean*0.6, 0-10 scale.
 * Heuristics are file-native and deterministic (no LLM).
 */
export interface FiveDim {
    S: number;
    R: number;
    J: number;
    C: number;
    Safety: number;
    composite: number;
}
export declare function computeFiveDim(opts: {
    projectTotal: number;
    withSummary: number;
    dailyCounts: number[];
    longestLen: number;
    hasAutoRecall: boolean;
    hasSanitize: boolean;
    hasGatedQueue: boolean;
}): FiveDim;
//# sourceMappingURL=health-score.d.ts.map