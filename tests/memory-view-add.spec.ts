import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The Memory tab lists entries read-only; the human has no way to record a
// durable fact without asking the model to do it. This pins the manual add
// composer to the EXISTING memory.mutate RPC so no new host surface is needed.
const src = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

const start = src.indexOf('function MemoryListView')
const end = src.indexOf('function HealthView')
const view = start >= 0 && end > start ? src.slice(start, end) : ''

describe('memory view manual add composer', () => {
  it('locates the Memory list view in the client source', () => {
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
  })

  it('renders a composer with the pinned testids', () => {
    expect(view).toContain("'data-testid':'mem-add-content'")
    expect(view).toContain("'data-testid':'mem-add-btn'")
  })

  it('posts to the existing memory.mutate RPC with action:add', () => {
    expect(view).toContain('memory.mutate')
    // The exact literal the host handler switches on.
    expect(view).toMatch(/action:\s*'add'/)
  })

  it('sends the selected track and the resolved cwd for key/project', () => {
    expect(view).toMatch(/target:\s*track/)
    expect(view).toMatch(/cwd:\s*needsCwd\s*\?\s*cwd\.trim\(\)\s*:\s*undefined/)
  })

  it('buckets the draft per track so switching tabs keeps typed text', () => {
    expect(view).toMatch(/useState<Record<string,string>>\(\{\}\)/)
    expect(view).toMatch(/drafts\[track\]/)
    // The write path must bucket by track too, never replace the whole map.
    expect(view).toMatch(/setDrafts\(prev=>\(\{\.\.\.prev,\[track\]:/)
  })

  it('blocks the add while empty or while key/project has no cwd', () => {
    expect(view).toMatch(/canAdd=/)
    expect(view).toMatch(/draft\.trim\(\)\.length>0/)
    // canAdd requires a cwd unless the track does not need one…
    expect(view).toContain('(!needsCwd || cwd.trim().length>0)')
    // …and the click handler re-checks before mutating.
    expect(view).toContain('needsCwd && !cwd.trim()')
    expect(view).toMatch(/disabled:\s*!canAdd/)
  })

  it('clears the draft and reloads only after a successful add', () => {
    expect(view).toMatch(/res\.ok===false/)
    expect(view).toMatch(/setDrafts\(prev=>\(\{\.\.\.prev,\[track\]:''\}\)\)/)
    expect(view).toMatch(/await load\(\)/)
  })

  it('labels the composer controls for assistive tech', () => {
    expect(view).toMatch(/'aria-label':`New \$\{track\} entry`/)
    expect(view).toMatch(/aria-label':'Add entry'|'aria-label': 'Add entry'/)
  })
})
