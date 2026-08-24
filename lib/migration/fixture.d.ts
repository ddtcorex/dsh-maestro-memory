/**
 * fixture.ts — helpers for M4-PR-A rehearsal: fixture profile with link: package/patch,
 * one-owner per compatibility tool, and copied-schema population (not live home).
 *
 * Pure helpers + minimal FS. No Cordis import, no network, no live home mutation.
 */
export interface CreateFixtureProfileOpts {
    profileDir: string;
    packageDir: string;
    profileName?: string;
}
export interface FixtureProfileResult {
    profileDir: string;
    packageJsonPath: string;
}
/**
 * Build a fixture profile with link: package/patch and prove one owner per tool.
 * - Creates <profileDir>/package.json with link: dependency to the local package checkout.
 * - Bundles list contains exactly one owner for each compat tool.
 * - Does NOT duplicate the cordis.patch.yml row (patch is owned by the package itself).
 */
export declare function createFixtureProfile(opts: CreateFixtureProfileOpts): Promise<FixtureProfileResult>;
export interface AssertSingleOwnerOpts {
    toolOwners?: Record<string, string[]>;
}
export interface AssertSingleOwnerResult {
    ok: boolean;
    owners: Record<string, string>;
    errors: string[];
}
/**
 * Prove one owner per compatibility tool for a fixture profile.
 * - By default derives owners from the profile's bundles (known mapping).
 * - If opts.toolOwners provided, uses that mapping to simulate duplicate detection (for tests).
 */
export declare function assertSingleOwner(profileDir: string, opts?: AssertSingleOwnerOpts): Promise<AssertSingleOwnerResult>;
/**
 * Populate a temp memory root with synthetic legacy files for rehearsal,
 * mirroring migration.spec's fixture but centralized for reuse.
 * This root is a *copy*, never the live ~/.dsh/memories.
 */
export declare function createCopiedMemoryRoot(root: string, opts?: {
    cwd?: string;
}): Promise<void>;
//# sourceMappingURL=fixture.d.ts.map