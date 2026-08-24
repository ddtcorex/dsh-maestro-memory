/**
 * migration/cli.ts — operations CLI requiring explicit --apply; default is read-only
 */
import { inspect, dryRun, run, verify } from "./service.js";
import { resolveMemoryRoot } from "../storage/layout.js";
export function parseArgs(argv) {
    const args = argv.slice(2);
    let root = null;
    let apply = false;
    let command = 'inspect';
    let runId;
    let help = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--help' || a === '-h')
            help = true;
        else if (a === '--apply')
            apply = true;
        else if (a === '--inspect')
            command = 'inspect';
        else if (a === '--dry-run' || a === '--dryRun')
            command = 'dryRun';
        else if (a === '--verify')
            command = 'verify';
        else if (a === '--run')
            command = 'run';
        else if (a === '--root' && i + 1 < args.length) {
            root = args[++i];
        }
        else if (a.startsWith('--root=')) {
            root = a.slice('--root='.length);
        }
        else if (a === '--run-id' && i + 1 < args.length) {
            runId = args[++i];
        }
        else if (a.startsWith('--run-id=')) {
            runId = a.slice('--run-id='.length);
        }
    }
    // explicit --apply forces run command unless verify explicitly requested
    if (apply && command === 'inspect')
        command = 'run';
    // if user asked --verify, keep verify even with --apply? But verify is separate
    // parse loyalty: --verify overrides apply's run conversion
    if (args.includes('--verify'))
        command = 'verify';
    return { root, apply, command, runId, help };
}
export function helpText() {
    return `
dsh-maestro-memory migration CLI

Default is read-only (inspect). Requires explicit --apply to perform backup+adoption.

Usage:
  node migrate.mjs [--root <path>] [--inspect|--dry-run|--verify] [--apply] [--run-id <id>]

Commands (read-only by default):
  --inspect       Read-only inventory, parse, warnings for malformed JSONL/locks/noncanonical (default)
  --dry-run       Same as inspect, explicitly read-only (no side effects)
  --verify        Verify current files against latest backup manifest (or --run-id); blocks writes on mismatch

Write operation (requires --apply):
  --apply         Perform migration: byte-preserving backup manifest + schema.json + journal
                  Without --apply, run is NOT executed (stays read-only)

Options:
  --root <path>   Memory root (default: ~/.dsh/memories)
  --run-id <id>   For verify: specific backup runId (default: latest / schema.json)

Examples:
  node scripts/migrate.mjs --root /tmp/memories            # inspect only
  node scripts/migrate.mjs --root /tmp/memories --dry-run  # dry-run
  node scripts/migrate.mjs --root /tmp/memories --apply    # backup + adopt
  node scripts/migrate.mjs --root /tmp/memories --verify   # verify

`.trim();
}
export async function main(parsed) {
    if (parsed.help) {
        console.log(helpText());
        return { ok: true, command: 'help' };
    }
    const root = parsed.root ? resolveMemoryRoot(parsed.root) : resolveMemoryRoot(null);
    if (parsed.command === 'verify') {
        const res = await verify(root, parsed.runId);
        if (res.ok) {
            console.log(`verify ok: runId=${res.runId} (${res.manifestPath})`);
        }
        else {
            console.error(`verify failed: runId=${res.runId}`);
            for (const m of res.mismatches)
                console.error(`  - ${m}`);
            console.error('writes are now blocked until mismatch is resolved (see .maestro-memory/write-block.json)');
        }
        return { ok: res.ok, command: 'verify', output: res };
    }
    if (parsed.command === 'run') {
        if (!parsed.apply) {
            // Safety: default is read-only, require explicit --apply
            const insp = await inspect(root);
            console.log('read-only inspect (dry-run): use --apply to perform migration');
            console.log(`files: ${insp.files.filter((f) => f.exists).length} existing, warnings: ${insp.warnings.length}`);
            for (const w of insp.warnings)
                console.log(`  warn: ${w}`);
            console.log(`inventory: memoryEntries=${insp.inventory.memoryEntries}, todos=${insp.inventory.todoIdsCount}, queue valid=${insp.inventory.queueValid} malformed=${insp.inventory.queueMalformed}`);
            return { ok: true, command: 'inspect', output: insp };
        }
        const res = await run(root);
        if (res.ok) {
            console.log(`run ok: runId=${res.runId}`);
            console.log(`manifest: ${res.manifestPath}`);
            console.log(`backup: ${res.backupFilesDir}`);
            if (res.warnings.length) {
                console.log('warnings:');
                for (const w of res.warnings)
                    console.log(`  - ${w}`);
            }
        }
        else {
            console.error(`run failed: ${res.errors.join('; ')}`);
            for (const w of res.warnings)
                console.error(`  warn: ${w}`);
        }
        return { ok: res.ok, command: 'run', output: res };
    }
    if (parsed.command === 'dryRun') {
        const res = await dryRun(root);
        console.log(`dryRun: ok=${res.ok}, warnings=${res.warnings.length}`);
        for (const w of res.warnings)
            console.log(`  warn: ${w}`);
        console.log(`inventory: memoryEntries=${res.inventory.memoryEntries}, todos=${res.inventory.todoIdsCount}`);
        return { ok: res.ok, command: 'dryRun', output: res };
    }
    // default inspect
    const res = await inspect(root);
    console.log(`inspect: ok=${res.ok}, files=${res.files.filter((f) => f.exists).length}, warnings=${res.warnings.length}`);
    for (const w of res.warnings)
        console.log(`  warn: ${w}`);
    console.log(`inventory: memoryEntries=${res.inventory.memoryEntries}, todos=${res.inventory.todoIdsCount}, queue valid=${res.inventory.queueValid} malformed=${res.inventory.queueMalformed}`);
    return { ok: res.ok, command: 'inspect', output: res };
}
//# sourceMappingURL=cli.js.map