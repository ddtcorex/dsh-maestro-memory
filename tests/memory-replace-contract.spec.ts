import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/host/index.ts'
import { readTurnFacts } from '../src/host/memory/write-guard.ts'

// Two contracts that only prose can carry:
//
// 1. `replace` swaps the WHOLE entry. Measured 2026-09-28 with this store: an
//    entry of 3 771 bytes became 82 after a `replace` whose content was one
//    sentence. An upstream memory plugin documented the same footgun only after
//    a real incident that had to be recovered from a git backup, so the
//    parameter description must say it before a model learns it the hard way.
// 2. A plugin-attributed turn is not a human turn. The write guard implements
//    that by treating only `undefined`/`'user'` kinds as human; this pins the
//    producer-side kind the supervisor now sends.

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maestro-replace-contract-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function fakeCtx() {
  const tools: any[] = []
  const contexts: any[] = []
  return {
    tools: { register: (t: any) => { tools.push(t); return () => {} } },
    systemPrompt: { context: (c: any) => { contexts.push(c); return () => {} } },
    connection: {
      rpc: { handle: () => () => {}, call: async () => ({ ok: true, value: {} }) },
    },
    effect: (fn: any) => fn(),
    on: () => () => {},
    get: () => undefined,
    state: { tools, contexts },
  } as any
}

function memoryTool(): any {
  const ctx = fakeCtx()
  apply(ctx, { memoryDir: root })
  const tool = ctx.state.tools.find((t: any) => t.name === 'memory')
  expect(tool, 'the memory tool must be registered').toBeDefined()
  return tool
}

describe('the memory tool states its replace contract', () => {
  // defineTool converts the parameter spec into a JSON Schema, so the copy the
  // model reads lives under `parameters.properties.<name>.description`.
  const parameterDescription = (name: string): string => {
    const tool = memoryTool()
    const description = tool.parameters?.properties?.[name]?.description
    expect(description, `parameter ${name} must carry a description`).toBeTypeOf('string')
    return String(description)
  }

  it('says content is the complete replacement entry', () => {
    const description = parameterDescription('content')
    expect(description).toMatch(/replace/i)
    expect(description).toMatch(/complete|entire|whole/i)
  })

  it('says where a usable match comes from', () => {
    const description = parameterDescription('match')
    expect(description).toMatch(/\blist\b/)
    expect(description).toMatch(/one entry|exactly one|uniqu/i)
  })
})

describe('plugin-attributed turns are not human turns', () => {
  it('treats the supervisor plugin kind as non-human', () => {
    const agent = {
      session: {
        ownEvents: () => [
          { type: 'turn/start' },
          {
            type: 'user/message',
            data: {
              source: { kind: 'plugin:@ddtcorex/dsh-maestro-supervisor' },
              content: [{ type: 'text', text: 'continue' }],
            },
          },
          { type: 'tool/call' },
        ],
      },
    }
    expect(readTurnFacts(agent).human).toBe(false)
  })

  it('still treats an untagged or user-kind prompt as human', () => {
    const events = (source?: unknown) => ({
      session: {
        ownEvents: () => [
          { type: 'turn/start' },
          { type: 'user/message', data: source === undefined ? {} : { source } },
          { type: 'tool/call' },
        ],
      },
    })
    expect(readTurnFacts(events({ kind: 'user' })).human).toBe(true)
    expect(readTurnFacts(events()).human).toBe(true)
  })
})
