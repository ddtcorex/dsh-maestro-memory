import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The queue badge is a <span class="dshmem-header-badge"> appended to the host's
// Memory tab button. That button is `display: block` and wraps its label in its
// own inner span, so an appended span is laid out as a block-level sibling: it
// drops onto a second line under the label, grows the tab strip from 35px to
// 52px, and lands on top of the active underline (measured live on DSH Web
// 0.2.2-alpha.2). The badge has to sit inline beside the label in a single row
// the plugin controls, which means pinning the tab box itself.
const client = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

const badgeCss = client.match(/const HEADER_BADGE_CSS = `([\s\S]*?)`/)?.[1] ?? ''

/** Declarations only — comments cannot cascade, so they must not match. */
const rules = badgeCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('memory tab queue badge stays inline with the label', () => {
  it('pins the host tab to a single inline row', () => {
    const tabRule = rules.match(/\[data-dshmem-memory-tab\][^{]*\{[^}]*\}/)?.[0] ?? ''
    expect(tabRule).not.toBe('')
    // inline-flex keeps the label and the badge on one row; a block box drops
    // the appended span onto its own line and stretches the tab strip
    expect(tabRule).toMatch(/display:\s*inline-flex/)
    expect(tabRule).toMatch(/align-items:\s*center/)
  })

  it('wins over the host tab rule regardless of stylesheet order', () => {
    const tabRule = rules.match(/\[data-dshmem-memory-tab\][^{]*\{[^}]*\}/)?.[0] ?? ''
    // the host ships `.…_tab { display: block }` at equal specificity; the
    // plugin style element may be injected before it on a slow boot
    expect(tabRule).toMatch(/display:\s*inline-flex\s*!important/)
  })

  it('keeps the badge a fixed 16px pill that cannot stretch the row', () => {
    const badgeRule = rules.match(/\n\.dshmem-header-badge \{[^}]*\}/)?.[0] ?? ''
    expect(badgeRule).toMatch(/flex:\s*none|flex-shrink:\s*0/)
    expect(badgeRule).toMatch(/height:\s*16px/)
  })

  it('keeps the pulse readable instead of fading the count to near-invisible', () => {
    // the badge pulses to signal unread suggestions; at 0.3 the 11px count on a
    // 16px red pill drops under the contrast floor
    const pulse = rules.match(/@keyframes dshmem-blink \{[^}]*\}[^}]*\}/)?.[0] ?? ''
    expect(pulse).not.toBe('')
    const half = Number(pulse.match(/50%\s*\{\s*opacity:\s*(\.\d+|\d(?:\.\d+)?)/)?.[1] ?? '0')
    expect(half).toBeGreaterThanOrEqual(0.55)
  })
})
