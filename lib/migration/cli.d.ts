/**
 * migration/cli.ts — operations CLI requiring explicit --apply; default is read-only
 */
export interface ParsedArgs {
    root: string | null;
    apply: boolean;
    command: 'inspect' | 'dryRun' | 'run' | 'verify';
    runId?: string;
    help: boolean;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare function helpText(): string;
export declare function main(parsed: ParsedArgs): Promise<{
    ok: boolean;
    command: string;
    output?: any;
}>;
//# sourceMappingURL=cli.d.ts.map