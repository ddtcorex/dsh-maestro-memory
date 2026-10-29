import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Regression locks for the 2026-10-28 design audit follow-ups
// (docs/reports/2026-10-28-dsh-maestro-memory-design-audit.md). Each block names
// the finding it pins and the measurement that motivated it.
const src = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

const memCss = src.match(/const MEM_CSS = `([\s\S]*?)`/)?.[1] ?? ''
const badgeCss = src.match(/const HEADER_BADGE_CSS = `([\s\S]*?)`/)?.[1] ?? ''
const memRules = memCss.replace(/\/\*[\s\S]*?\*\//g, '')
const badgeRules = badgeCss.replace(/\/\*[\s\S]*?\*\//g, '')
const healthView = src.slice(src.indexOf('function HealthView'), src.indexOf('// ── Root'))
const skillsView = src.slice(src.indexOf('function SkillsView'), src.indexOf('// ── Memory List'))
const rootView = src.slice(src.indexOf('function MemoryView'), src.length)

describe('F3 Health reports only what the store says', () => {
  it('no longer paints a hardcoded discipline metric', () => {
    expect(src).not.toContain('1.5 avg / session')
    expect(src).not.toMatch(/'Discipline'/)
  })

  it('derives coverage from the shared helper instead of the raw host ratio', () => {
    expect(healthView).toContain('coverageSummary(')
    expect(healthView).toContain('seriesText(')
  })

  it('sends the coverage value through the tinted chip, not a raw state colour', () => {
    expect(healthView).toContain("className:'memx-stat-value'")
    expect(healthView).toContain("'data-state':cov.state")
    expect(healthView).not.toMatch(/style:\{color:covColor\}/)
  })
})

describe('F4 + F7 the stylesheet survives the light theme', () => {
  it('no state colour is used as text on a plain surface', () => {
    expect(memRules).toContain('.memx-stat-value')
    // the chip carries the tint; the text stays label-primary
    expect(memRules).toMatch(/\.memx-stat-value \{[^}]*color: var\(--dsw-alias-label-primary\)/)
  })

  it('cards keep a boundary when layer-1 and bg-base both resolve to #fff', () => {
    const shadowRule = memRules.match(/\.memx-card, \.memx-form, \.memx-empty, \.memx-dim-card \{[^}]*\}/)?.[0] ?? ''
    expect(shadowRule).toContain('box-shadow')
    expect(shadowRule).toContain('color-mix')
  })
})

describe('F5 Skills owns its empty state', () => {
  it('does not render the same sentence in the empty state and the status line', () => {
    expect(skillsView).not.toMatch(/msg\s*\|\|\s*'No skills'/)
    expect(skillsView).toContain("'No skills found'")
  })

  it('shortens the absolute skill path', () => {
    expect(skillsView).toContain('shortPath(e.path)')
  })
})

describe('F6 every section announces through the shared status line', () => {
  it('renders MemStatus in all five sections', () => {
    const uses = src.match(/React\.createElement\(MemStatus,/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(5)
  })

  it('styles failures with the error colour, not muted grey', () => {
    expect(memRules).toMatch(/\.memx-status-error \{[^}]*var\(--dsw-alias-state-error-primary\)/)
  })
})

describe('F1 + F9 + F12 mobile rail, touch floor and empty states', () => {
  // there are several @media (max-width:1023px) blocks (one is a one-liner);
  // collect every one of them, matching braces because rules nest
  const mobile = (() => {
    const blocks: string[] = []
    let from = 0
    for (;;) {
      const at = memRules.indexOf('@media (max-width:1023px)', from)
      if (at < 0) break
      const open = memRules.indexOf('{', at)
      let depth = 0
      let end = open
      for (let i = open; i < memRules.length; i += 1) {
        if (memRules[i] === '{') depth += 1
        else if (memRules[i] === '}') {
          depth -= 1
          if (depth === 0) { end = i + 1; break }
        }
      }
      blocks.push(memRules.slice(open, end))
      from = end
    }
    return blocks.join('\n')
  })()

  it('wraps the section rail instead of hiding two sections in a scroller', () => {
    expect(mobile).toMatch(/\.memx-nav \{[^}]*display:grid/)
    expect(mobile).toMatch(/\.memx-navcount \{[^}]*display:none/)
  })

  it('holds pills and form fields at the 44px touch floor', () => {
    expect(mobile).toMatch(/\.memx-pill, \.memx-select, \.memx-search \{ min-height:44px/)
  })

  it('keeps empty states from stretching into a full-width slab', () => {
    const emptyRule = memRules.match(/\n\.memx-empty \{[^}]*\}/)?.[0] ?? ''
    expect(emptyRule).toMatch(/max-width:520px/)
    expect(emptyRule).toMatch(/text-align:left/)
  })
})

describe('F14 + F11 density stays out of the first screen', () => {
  it('starts the todo composer collapsed', () => {
    expect(src).toContain('const [openAdd,setOpenAdd]=React.useState(false)')
  })

  it('shows the queue reason once and puts the edit box behind a toggle', () => {
    const queue = src.slice(src.indexOf('function ReviewQueueView'), src.indexOf('// ── Todos'))
    expect(queue.match(/Reason: \$\{e\.reason\}/g)?.length).toBe(1)
    expect(queue).not.toContain('e.reason.slice(0,80)')
    expect(queue).toMatch(/editOpen\[number\] \?/)
  })
})

describe('F17 + F10 the tab strip and its badge are usable without a mouse', () => {
  it('implements roving tabindex and arrow keys on the section tabs', () => {
    expect(rootView).toContain('onKeyDown:onNavKey')
    expect(rootView).toMatch(/tabIndex: tab===t\.id \? 0 : -1/)
    expect(rootView).toMatch(/e\.key === 'ArrowDown'/)
    expect(rootView).toMatch(/'aria-labelledby'/)
  })

  it('keeps the count out of the tab name and exposes it as a description', () => {
    expect(badgeRules).toContain('.dshmem-sr-only')
    expect(src).toContain("badge.setAttribute('aria-hidden','true')")
    expect(src).toContain("tab.setAttribute('aria-describedby', DESCR_ID)")
  })
})

describe('F19 the plugin no longer restyles host chrome globally', () => {
  it('dropped the unscoped viewArea / slot rules', () => {
    expect(memRules).not.toMatch(/\n\[class\*="viewArea"\] \{/)
    expect(memRules).not.toMatch(/\n\[data-slot="conversation\.view"\] \{/)
    expect(memRules).not.toMatch(/\n\[data-slot="conversation\.session"\] \{/)
  })

  it('keeps the scoped variants that do the real work', () => {
    expect(memRules).toContain('[data-conversation-scroll]:has(.memx)')
  })
})
