import { describe, it, expect } from 'vitest'
import { createWriteGapCounter, lastTurnWasMessage, readTurnFacts } from '../src/host/memory/write-guard.ts'

/**
 * Minimal Cordis-shaped context: `on` returns a disposer (the real contract),
 * `effect` runs the factory immediately and remembers its disposer so a test
 * can prove the listener is actually removed on teardown.
 */
function fakeCtx() {
  const handlers = new Map<string, any>()
  const effects: Array<() => void> = []
  return {
    on: (ev: string, fn: any) => {
      handlers.set(ev, fn)
      return () => handlers.delete(ev)
    },
    effect: (fn: any) => {
      const d = fn()
      effects.push(typeof d === 'function' ? d : () => {})
      return () => {}
    },
    _emit: (ev: string, ...args: any[]) => {
      const fn = handlers.get(ev)
      if (fn) fn(...args)
    },
    _dispose: () => {
      for (const d of effects) d()
    },
    _hasListener: (ev: string) => handlers.has(ev),
  }
}

/**
 * An agent whose last turn began with a `user/message` of the given source kind.
 * `tools` appends that many `tool/call` events — a turn that dispatched no tool
 * at all is a pure question/answer turn.
 */
function fakeAgent(id: string, opts: { origin?: 'subagent'; kind?: string; events?: any[]; useOwnEvents?: boolean; tools?: number } = {}) {
  const events = opts.events ?? [
    { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 0, data: { source: opts.kind === undefined ? { kind: 'user' } : { kind: opts.kind } } },
    ...Array.from({ length: opts.tools ?? 1 }, (_, i) => (
      { type: 'tool/call', seq: 3 + i, time: 0, data: { turn: 1, step: 1, callId: `c${i}`, name: 'bash', arguments: '{}' } }
    )),
  ]
  const session: any = { header: { origin: opts.origin, cwd: '/tmp/proj' }, events }
  if (opts.useOwnEvents !== false) session.ownEvents = () => events
  return { id, session }
}

function stop(ctx: any, agent: any) {
  ctx._emit('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
}

describe('lastTurnWasMessage', () => {
  it('is true when the turn opened with a direct human prompt', () => {
    expect(lastTurnWasMessage(fakeAgent('a', { kind: 'user' }))).toBe(true)
  })

  it('is true when source.kind is absent (older hosts do not tag it)', () => {
    const agent = fakeAgent('a', {
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { content: [] } },
      ],
    })
    expect(lastTurnWasMessage(agent)).toBe(true)
  })

  it('is false for a goal continuation round (source.kind "goal")', () => {
    expect(lastTurnWasMessage(fakeAgent('a', { kind: 'goal' }))).toBe(false)
  })

  it('is false for synthetic injected context (source.kind "plugin")', () => {
    expect(lastTurnWasMessage(fakeAgent('a', { kind: 'plugin' }))).toBe(false)
  })

  it('is false when the turn has no user/message at all', () => {
    expect(lastTurnWasMessage(fakeAgent('a', { events: [{ type: 'turn/start', data: { turn: 1 } }] }))).toBe(false)
  })

  it('is false when no turn/start is present', () => {
    expect(lastTurnWasMessage(fakeAgent('a', { events: [{ type: 'user/message', data: { source: { kind: 'user' } } }] }))).toBe(false)
  })

  it('reads the newest turn only — an earlier human turn does not leak forward', () => {
    const agent = fakeAgent('a', {
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'turn/start', data: { turn: 2 } },
        { type: 'user/message', data: { source: { kind: 'goal' } } },
      ],
    })
    expect(lastTurnWasMessage(agent)).toBe(false)
  })

  it('falls back to session.events when ownEvents is absent', () => {
    expect(lastTurnWasMessage(fakeAgent('a', { kind: 'user', useOwnEvents: false }))).toBe(true)
  })

  it('is false for a missing session instead of throwing', () => {
    expect(lastTurnWasMessage(undefined)).toBe(false)
    expect(lastTurnWasMessage({ id: 'a' })).toBe(false)
  })
})

describe('readTurnFacts', () => {
  it('reports a human turn and how many tools it dispatched', () => {
    expect(readTurnFacts(fakeAgent('a', { tools: 3 }))).toEqual({ human: true, toolCalls: 3 })
  })

  it('reports zero tool calls for a pure question/answer turn', () => {
    expect(readTurnFacts(fakeAgent('a', { tools: 0 }))).toEqual({ human: true, toolCalls: 0 })
  })

  it('counts tool calls that follow the human prompt', () => {
    const agent = fakeAgent('a', {
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'tool/call', data: { name: 'read' } },
        { type: 'tool/result', data: {} },
        { type: 'tool/call', data: { name: 'edit' } },
      ],
    })
    expect(readTurnFacts(agent)).toEqual({ human: true, toolCalls: 2 })
  })

  it('does not count tool calls from an earlier turn', () => {
    const agent = fakeAgent('a', {
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
        { type: 'tool/call', data: { name: 'bash' } },
        { type: 'turn/start', data: { turn: 2 } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
      ],
    })
    expect(readTurnFacts(agent)).toEqual({ human: true, toolCalls: 0 })
  })

  it('reports a non-human origin with no facts to act on', () => {
    expect(readTurnFacts(fakeAgent('a', { kind: 'goal', tools: 2 }))).toEqual({ human: false, toolCalls: 2 })
  })

  it('reports nothing for a missing session instead of throwing', () => {
    expect(readTurnFacts(undefined)).toEqual({ human: false, toolCalls: 0 })
    expect(readTurnFacts({ id: 'a' })).toEqual({ human: false, toolCalls: 0 })
  })
})

describe('createWriteGapCounter', () => {
  it('counts one gap per completed human turn', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const agent = fakeAgent('a')
    expect(guard.gapOf(agent)).toBe(0)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(1)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(2)
  })

  it('resets the gap when that turn wrote daily/project memory', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const agent = fakeAgent('a')
    stop(ctx, agent)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(2)
    guard.noteWrite(agent)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(0)
  })

  it('a writing turn is not itself counted as a gap (mid-turn write timing)', () => {
    // noteWrite happens while the turn is still running; the turn-stopping that
    // follows must reset, not increment. Resetting inside noteWrite would make
    // this turn count as a gap and fire at threshold 1 on every healthy turn.
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const agent = fakeAgent('a')
    guard.noteWrite(agent)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(0)
    // The flag is consumed: the next write-less turn is a real gap of 1, not 2.
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(1)
  })

  it('does not count a human turn that dispatched no tool (pure Q&A)', () => {
    // Answering a question is not work: pressing the model to write an entry
    // here is exactly the filler the discipline note forbids.
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const agent = fakeAgent('a', { tools: 0 })
    stop(ctx, agent)
    stop(ctx, agent)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(0)
  })

  it('starts counting again as soon as a turn dispatches a tool', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const agent = fakeAgent('a', { tools: 0 })
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(0)
    agent.session.events.push({ type: 'tool/call', data: { name: 'bash' } })
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(1)
  })

  it('does not count subagent sessions', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const agent = fakeAgent('sub', { origin: 'subagent' })
    stop(ctx, agent)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(0)
  })

  it('does not count goal-continuation or injected turns', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const goal = fakeAgent('g', { kind: 'goal' })
    const injected = fakeAgent('i', { kind: 'plugin' })
    stop(ctx, goal)
    stop(ctx, injected)
    expect(guard.gapOf(goal)).toBe(0)
    expect(guard.gapOf(injected)).toBe(0)
  })

  it('stops accumulating while disabled', () => {
    const ctx: any = fakeCtx()
    let enabled = false
    const guard = createWriteGapCounter(ctx, () => enabled)
    const agent = fakeAgent('a')
    stop(ctx, agent)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(0)
    enabled = true
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(1)
  })

  it('tracks each session independently', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const a = fakeAgent('a')
    const b = fakeAgent('b')
    stop(ctx, a)
    stop(ctx, a)
    stop(ctx, b)
    expect(guard.gapOf(a)).toBe(2)
    expect(guard.gapOf(b)).toBe(1)
  })

  it('reports 0 for an unknown or missing agent', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    expect(guard.gapOf(undefined)).toBe(0)
    expect(guard.gapOf({ id: 'never-seen' })).toBe(0)
  })

  it('isolates a hostile payload instead of failing the turn', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const boom = {
      id: 'boom',
      get session(): any {
        throw new Error('hostile getter')
      },
    }
    expect(() => stop(ctx, boom)).not.toThrow()
    expect(() => guard.noteWrite(boom)).not.toThrow()
    expect(guard.gapOf(boom)).toBe(0)
  })

  it('ignores noteWrite without an agent id', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    expect(() => guard.noteWrite(undefined)).not.toThrow()
    const agent = fakeAgent('a')
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(1)
  })

  it('registers the listener through ctx.effect and removes it on dispose', () => {
    const ctx: any = fakeCtx()
    const guard = createWriteGapCounter(ctx, () => true)
    const agent = fakeAgent('a')
    expect(ctx._hasListener('agent/turn-stopping')).toBe(true)
    ctx._dispose()
    expect(ctx._hasListener('agent/turn-stopping')).toBe(false)
    stop(ctx, agent)
    expect(guard.gapOf(agent)).toBe(0)
  })
})
