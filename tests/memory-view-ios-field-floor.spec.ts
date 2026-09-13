import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// iOS WebKit zooms the whole visual viewport when a focused <input>/<textarea>
// computes a font-size below 16px, so dsh-maestro-mobile holds every text field
// on the page at a 16px floor under `html[data-mobile-nav-ios]`, inside
// `(max-width: 1023px) and (pointer: coarse)`. Left alone, that floor makes the
// panel's placeholders and typed text 3px larger than every card and label
// around them. The panel is a dense tool surface designed at 13px, so it opts
// its own fields out of the floor and keeps the size it was designed with.
const client = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

const css = client.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''

/** Declarations only — comments cannot cascade, so they must not match. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Predicate the mobile plugin's field floor is published inside. */
const FLOOR_QUERY = '@media (max-width: 1023px) and (pointer: coarse)'

/** The opt-out block, empty when it is missing. */
function floorBlock(): string {
  const start = rules.indexOf(FLOOR_QUERY)
  if (start < 0) return ''
  const open = rules.indexOf('{', start)
  const close = rules.indexOf('\n}', open)
  if (open < 0 || close < 0) return ''
  return rules.slice(open + 1, close)
}

describe('memory view keeps its own 13px scale on iOS', () => {
  it('keeps the 13px body size wherever no field floor applies', () => {
    const rootRule = rules.match(/\n\.memx \{[^}]*\}/)?.[0] ?? ''
    expect(rootRule).toMatch(/font-size:\s*13px/)
  })

  it('never opts fields out outside the floor predicate', () => {
    const guardAt = rules.indexOf('html[data-mobile-nav-ios]')
    expect(guardAt).toBeGreaterThan(-1)
    // the override must sit inside the media query, not before it
    expect(guardAt).toBeGreaterThan(rules.indexOf(FLOOR_QUERY))
  })

  it('pins the panel fields back to the 13px the panel is designed at', () => {
    const block = floorBlock()
    expect(block).toContain('html[data-mobile-nav-ios] .memx input')
    expect(block).toContain('.memx textarea')
    expect(block).toContain('.memx select')
    // the floor is published with !important, so the opt-out must be too
    expect(block).toMatch(/font-size:\s*13px\s*!important/)
  })

  it('out-ranks the floor selector, which carries ten :not([type=…]) clauses', () => {
    const block = floorBlock()
    // id-level specificity is what beats that chain; without it the floor wins
    // and the fields silently grow back to 16px
    expect(block).toMatch(/:not\(#[A-Za-z][\w-]*\)/)
  })
})
