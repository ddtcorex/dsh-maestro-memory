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

  it('styles the primary button with design-system tokens, not a hardcoded hex', () => {
    // The file header already promised "all via DSH --dsw-alias-* tokens" and
    // listed hardcoded light hex under AVOID, while `.memx-btn-primary` shipped
    // a literal #06c/#05a. The harness's own ui-primitives/Button.module.css
    // `.primary` is the reference recipe.
    const css = src.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
    expect(css).toMatch(/\.memx-btn-primary \{[^}]*var\(--dsw-alias-button-primary-fill\)/)
    expect(css).toMatch(/\.memx-btn-primary \{[^}]*var\(--dsw-alias-label-primary-foreground\)/)
    expect(css).toMatch(/\.memx-btn-primary:hover:not\(:disabled\) \{[^}]*var\(--dsw-alias-button-primary-hover\)/)
    expect(css).not.toContain('#06c')
    expect(css).not.toContain('#05a')
  })

  it('keeps a disabled button out of the hover state entirely', () => {
    // `.memx-btn:hover` (0,2,0) outranks `.memx-btn-primary` (0,1,0), so the
    // generic hover rule repainted a DISABLED primary button white. The Add
    // button is the plugin's first disabled button, which is what exposed it.
    const css = src.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
    expect(css).toMatch(/\.memx-btn:hover:not\(:disabled\)/)
    expect(css).toMatch(/\.memx-btn-primary:hover:not\(:disabled\)/)
    expect(css).not.toMatch(/\.memx-btn:hover \{/)
  })

  it('announces the add result through a live status region', () => {
    // Without this the "added to daily" / "add failed" outcome is silent for
    // screen readers: the message is plain text, not a live region.
    expect(view).toMatch(/role:'status'/)
    expect(view).toMatch(/'aria-live':'polite'/)
  })

  it('mounts the live region up front, not only when a message exists', () => {
    // A live region added to the DOM together with its text is unreliable:
    // assistive tech registers the region, then observes its updates. The
    // container must therefore exist before there is anything to announce,
    // which is why it is not behind a `msg ?` guard.
    expect(view).not.toMatch(/msg\?React\.createElement\('div',\{className:'memx-muted'/)
    expect(view).toMatch(/memx-status/)
  })

  it('keeps the empty live region out of layout without leaving the a11y tree', () => {
    // `display:none` would remove it from the accessibility tree and silence
    // the announcement; the clip technique hides it visually only.
    const css = src.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
    expect(css).toContain('.memx-status:empty')
    expect(css).toMatch(/\.memx-status:empty \{[^}]*clip-path/)
    expect(css).toMatch(/\.memx-status:empty \{[^}]*position:absolute/)
  })
})
