/**
 * health-score.ts — 5-dim scoring (S/R/J/C/Safety) per memory_score.md
 * Composite = min*0.4 + mean*0.6, 0-10 scale.
 * Heuristics are file-native and deterministic (no LLM).
 */
function clamp01(v) {
    return Math.max(0, Math.min(10, Math.round(v * 10) / 10));
}
export function computeFiveDim(opts) {
    const coverage = opts.projectTotal ? opts.withSummary / opts.projectTotal : 1;
    const dailyActive = opts.dailyCounts.filter((n) => n > 0).length;
    // S Storage: layered files (memory/user/project/key/daily) + daily activity + summary
    const S = clamp01(6 + coverage * 1.5 + (dailyActive > 2 ? 0.5 : 0) + (opts.longestLen > 0 ? 0.5 : 0));
    // R Retrieval: branch filter + recentDaily + autoRecall
    const R = clamp01(5.5 + (opts.hasAutoRecall ? 1.5 : 0) + (dailyActive > 0 ? 0.5 : 0) + (coverage > 0.8 ? 0.5 : 0));
    // J Judgment: dedupe + summary + gated queue + sanitize
    const J = clamp01(5 + coverage + (opts.hasGatedQueue ? 1 : 0) + (opts.hasSanitize ? 0.8 : 0));
    // C Context SNR: bounded caps + autoRecall + recentDaily + coverage
    const C = clamp01(6 + (opts.hasAutoRecall ? 1 : 0) + (dailyActive > 0 ? 0.8 : 0) + coverage * 0.7);
    // Safety: loopback + gated + desensitize
    const Safety = clamp01(5.5 + (opts.hasSanitize ? 1.2 : 0) + (opts.hasGatedQueue ? 1 : 0) + (coverage > 0.5 ? 0.3 : 0));
    const vals = [S, R, J, C, Safety];
    const min = Math.min(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const composite = clamp01(min * 0.4 + mean * 0.6);
    return { S, R, J, C, Safety, composite };
}
//# sourceMappingURL=health-score.js.map