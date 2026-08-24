#!/usr/bin/env node
/**
 * Operations CLI for dsh-maestro-memory migration.
 * Default is read-only (inspect). Requires explicit --apply to perform backup+adoption.
 *
 * Usage:
 *   node scripts/migrate.mjs --root <path> [--inspect|--dry-run|--verify|--apply]
 */

import { parseArgs, main, helpText } from '../lib/migration/cli.js'

const parsed = parseArgs(process.argv)
if (parsed.help) {
  console.log(helpText())
  process.exit(0)
}

const result = await main(parsed)
process.exit(result.ok ? 0 : 1)
