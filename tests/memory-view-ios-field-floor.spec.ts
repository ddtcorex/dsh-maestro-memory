import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// iOS WebKit zooms the whole visual viewport when a focused <input>/<textarea>
// computes a font-size below 16px, so dsh-maestro-mobile holds every text field
// on the page at a 16px floor under `html[data-mobile-nav-ios]`. An earlier
// revision of this panel opted its own fields back out to 13px for a dense
// 13px scale — and every tap on those fields zoomed the page on iPhone (user
// report). Function beats pixels: the panel holds its fields at the same 16px
// on iOS. Android and desktop never carry the marker, so the 13px scale they
// were designed with is untouched.
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

describe('memory view holds the iOS 16px field floor', () => {
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

  it('holds the panel fields at 16px on iOS (opting out re-enables focus zoom)', () => {
    const block = floorBlock()
    expect(block).toContain('html[data-mobile-nav-ios] .memx input')
    expect(block).toContain('.memx textarea')
    expect(block).toContain('.memx select')
    // the floor is published with !important, so the hold must be too
    expect(block).toMatch(/font-size:\s*16px\s*!important/)
    expect(block).not.toMatch(/font-size:\s*(13px|inherit)\s*!important/)
  })

  it('out-ranks the floor selector, which carries ten :not([type=…]) clauses', () => {
    const block = floorBlock()
    // id-level specificity keeps this declaration winning over the floor; without it
    // a later equal-specificity rule could silently shrink the fields back below 16px
    expect(block).toMatch(/:not\(#[A-Za-z][\w-]*\)/)
  })
})
