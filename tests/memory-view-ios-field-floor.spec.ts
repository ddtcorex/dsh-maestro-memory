import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// iOS WebKit zooms the whole visual viewport when a focused <input>/<textarea>
// computes a font-size below 16px, so dsh-maestro-mobile holds every text field
// on the page at a 16px floor under `html[data-mobile-nav-ios]`, inside
// `(max-width: 1023px) and (pointer: coarse)`. The panel's own body text would
// keep its 13px desktop size, so on a phone the field placeholders and the text
// typed into them render 3px larger than the cards and labels around them.
// The panel therefore has to ride the same floor, under the identical
// predicate, so the field floor never desynchronises it from its own fields.
const client = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

const css = client.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''

/** Declarations only — comments cannot cascade, so they must not match. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Predicate the mobile plugin's field floor is published inside. */
const FLOOR_QUERY = '@media (max-width: 1023px) and (pointer: coarse)'

/** Markup of the field-floor media block, empty when it is missing. */
function floorBlock(): string {
  const start = rules.indexOf(FLOOR_QUERY)
  if (start < 0) return ''
  const open = rules.indexOf('{', start)
  const close = rules.indexOf('\n}', open)
  if (open < 0 || close < 0) return ''
  return rules.slice(open + 1, close)
}

describe('memory view rides the iOS field floor', () => {
  it('keeps the 13px body size wherever no field floor applies', () => {
    const rootRule = rules.match(/\n\.memx \{[^}]*\}/)?.[0] ?? ''
    expect(rootRule).toMatch(/font-size:\s*13px/)
  })

  it('never raises the panel outside the floor predicate (desktop stays 13px)', () => {
    const guardAt = rules.indexOf('html[data-mobile-nav-ios]')
    expect(guardAt).toBeGreaterThan(-1)
    // the guard must sit inside the media query, not before it
    expect(guardAt).toBeGreaterThan(rules.indexOf(FLOOR_QUERY))
  })

  it('raises the whole panel to the same 16px the fields are held at on iOS', () => {
    const block = floorBlock()
    expect(block).toContain('html[data-mobile-nav-ios] .memx')
    expect(block).toMatch(/font-size:\s*16px/)
  })
})
