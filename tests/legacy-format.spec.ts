import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ENTRY_DELIMITER,
  parseEntries,
  serializeEntries,
  isCanonical,
  extractEntryDate,
  BRANCH_TAG_RE,
  parseEntryBranches,
  DSH_ONLY_TAG,
  DSH_ONLY_RE,
  parseEntryDshOnly,
  SUMMARY_TAG_RE,
  parseEntrySummary,
  stripEntrySummary,
  autoSummary,
  splitEntryHead,
  TODO_HEADER,
  TODO_TARGETS,
  TODO_STATUSES,
  parseTodoEntry,
  stampTodoLine,
} from '../src/host/storage/legacy-format.js'

describe('legacy-format: no Cordis import', () => {
  it('does not import cordis', () => {
    const src = readFileSync(new URL('../src/host/storage/legacy-format.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from\s+['"]cordis['"]/)
    expect(src).not.toMatch(/import\s+.*cordis/)
    expect(src).not.toMatch(/require\(['"]cordis['"]\)/)
  })
})

describe('§ delimiter', () => {
  it('ENTRY_DELIMITER is \\n§\\n', () => {
    expect(ENTRY_DELIMITER).toBe('\n§\n')
  })

  it('parseEntries: splits, trims, drops empty', () => {
    expect(parseEntries('')).toEqual([])
    expect(parseEntries('   \n')).toEqual([])
    expect(parseEntries('a\n§\nb\n')).toEqual(['a', 'b'])
    expect(parseEntries('  a  \n§\n  b  \n')).toEqual(['a', 'b'])
    expect(parseEntries('a\n§\n\n§\nb\n')).toEqual(['a', 'b'])
    expect(parseEntries('a\n§\nb')).toEqual(['a', 'b'])
    const entries = ['first', 'second\nmultiline', 'third']
    expect(parseEntries(serializeEntries(entries))).toEqual(entries)
  })

  it('serializeEntries: joins with delimiter + trailing newline', () => {
    expect(serializeEntries([])).toBe('\n')
    expect(serializeEntries(['a'])).toBe('a\n')
    expect(serializeEntries(['a', 'b'])).toBe('a\n§\nb\n')
    const entries = ['第一条', '第二条\n多行内容', 'third entry']
    const text = serializeEntries(entries)
    expect(isCanonical(text)).toBe(true)
    expect(parseEntries(text)).toEqual(entries)
  })

  it('isCanonical validates canonical form', () => {
    expect(isCanonical('')).toBe(true)
    expect(isCanonical('   \n')).toBe(true)
    expect(isCanonical('a\n§\nb\n')).toBe(true)
    expect(isCanonical('a\n\n§\nb\n')).toBe(false)
    expect(isCanonical('a\n§\nb')).toBe(false)
    expect(isCanonical(serializeEntries(['x', 'y']))).toBe(true)
  })

  it('extractEntryDate extracts YYYY-MM-DD', () => {
    expect(extractEntryDate('[2026-08-15] content')).toBe('2026-08-15')
    expect(extractEntryDate('[2026-08-15 08:30] content')).toBe('2026-08-15')
    expect(extractEntryDate('[id:deadbeef] [2026-08-15] content')).toBe('2026-08-15')
    expect(extractEntryDate('[12:30] content')).toBe(null)
    expect(extractEntryDate('no date')).toBe(null)
    expect(extractEntryDate('')).toBe(null)
  })
})

describe('branch tags', () => {
  it('BRANCH_TAG_RE and parseEntryBranches', () => {
    expect(BRANCH_TAG_RE).toBeInstanceOf(RegExp)
    expect(parseEntryBranches('[2026-08-06] [branch:main,dev] content')).toEqual(['main', 'dev'])
    expect(parseEntryBranches('[branch:main] content')).toEqual(['main'])
    expect(parseEntryBranches('[2026-08-06] [branch:] content')).toBe(null)
    expect(parseEntryBranches('[2026-08-06] content without branch')).toBe(null)
    expect(parseEntryBranches('[2026-08-06] [branch: main , dev ] content')).toEqual(['main', 'dev'])
    expect(parseEntryBranches('[2026-08-06] [branch:feature-x] hello')).toEqual(['feature-x'])
  })

  it('branch tag preserved via splitEntryHead', () => {
    const entry = '[2026-08-06] [branch:main,dev] real content'
    const { head, body } = splitEntryHead(entry, 'key')
    expect(head).toContain('[branch:main,dev]')
    expect(body).toBe('real content')
  })
})

describe('DSH-only marker', () => {
  it('parseEntryDshOnly detects marker anywhere', () => {
    expect(parseEntryDshOnly('[2026-08-06] [dsh-only] content')).toBe(true)
    expect(parseEntryDshOnly('[2026-08-06] content [dsh-only] more')).toBe(true)
    expect(parseEntryDshOnly('[2026-08-06] content')).toBe(false)
    expect(parseEntryDshOnly('')).toBe(false)
    expect(DSH_ONLY_TAG).toBe('[dsh-only]')
    expect(DSH_ONLY_RE).toBeInstanceOf(RegExp)
  })
})

describe('summaries', () => {
  it('parseEntrySummary: only header position', () => {
    expect(parseEntrySummary('[2026-08-15] [summary:一句话摘要] 正文内容')).toBe('一句话摘要')
    expect(
      parseEntrySummary('[id:deadbeef] [2026-08-15] [branch:main] [dsh-only] [summary:带全套头部] 正文'),
    ).toBe('带全套头部')
    expect(parseEntrySummary('[2026-08-15] 正文没有摘要标签')).toBe(null)
    expect(parseEntrySummary('[2026-08-15] 正文提到 [summary:正文文本] 不算')).toBe(null)
    expect(parseEntrySummary('[2026-08-15] [summary:真的] [summary:假的] 正文')).toBe('真的')
    expect(parseEntrySummary('[12:30] [git main] [summary:每日条目摘要] 内容')).toBe('每日条目摘要')
    expect(SUMMARY_TAG_RE).toBeInstanceOf(RegExp)
  })

  it('stripEntrySummary: removes only header summary', () => {
    expect(stripEntrySummary('[2026-08-15] [summary:摘要] 正文')).toBe('[2026-08-15] 正文')
    expect(
      stripEntrySummary('[id:deadbeef] [2026-08-15] [branch:main] [dsh-only] [summary:摘要] 正文'),
    ).toBe('[id:deadbeef] [2026-08-15] [branch:main] [dsh-only] 正文')
    expect(stripEntrySummary('[2026-08-15] 正文 [foo] [summary:bar] 结尾')).toBe(
      '[2026-08-15] 正文 [foo] [summary:bar] 结尾',
    )
    expect(stripEntrySummary('[2026-08-15] 普通正文')).toBe('[2026-08-15] 普通正文')
  })

  it('autoSummary: strips header then takes first line, truncates', () => {
    expect(autoSummary('[2026-08-15] 构建用 DSH_SOURCE 指定检出根')).toBe(
      '构建用 DSH_SOURCE 指定检出根',
    )
    expect(autoSummary('[2026-08-15] [summary:显式摘要] 正文首行')).toBe('正文首行')
    expect(
      autoSummary('[id:deadbeef] [2026-08-15] [branch:main] [dsh-only] 全套头部后的正文'),
    ).toBe('全套头部后的正文')
    expect(autoSummary('[12:30] [git main] 每日日志的正文行')).toBe('每日日志的正文行')
    expect(autoSummary('[2026-08-15 08:30] [git dev] 项目日志正文')).toBe('项目日志正文')
    const long = 'x'.repeat(100)
    const out = autoSummary(`[2026-08-15] ${long}`)
    expect(out.length).toBe(80)
    expect(out.endsWith('…')).toBe(true)
    expect(autoSummary('[2026-08-15] 第一行\n第二行')).toBe('第一行')
  })

  it('stripEntrySummary and parseEntrySummary consistency', () => {
    const entry = '[2026-08-15] [branch:main] [summary:一致性别丢] 正文内容'
    const parsed = parseEntrySummary(entry)
    const stripped = stripEntrySummary(entry)
    expect(parsed).toBe('一致性别丢')
    expect(stripped).not.toContain('summary')
    expect(stripped.endsWith('正文内容')).toBe(true)
  })
})

describe('splitEntryHead', () => {
  it('separates head and body for different targets', () => {
    let r = splitEntryHead('[2026-08-15] hello world', 'memory')
    expect(r.head).toBe('[2026-08-15] ')
    expect(r.body).toBe('hello world')

    r = splitEntryHead('[2026-08-15] [branch:main] [dsh-only] [summary:sum] body', 'memory')
    expect(r.head).toContain('[branch:main]')
    expect(r.head).toContain('[dsh-only]')
    expect(r.head).toContain('[summary:sum]')
    expect(r.body).toBe('body')

    r = splitEntryHead('[2026-08-15 08:30] [git main] project body', 'project')
    expect(r.head).toContain('[2026-08-15 08:30]')
    expect(r.head).toContain('[git main]')
    expect(r.body).toBe('project body')

    r = splitEntryHead('[08:30] daily body', 'daily')
    expect(r.head).toContain('[08:30]')
    expect(r.body).toBe('daily body')

    r = splitEntryHead('[id:deadbeef] [2026-08-15] body with id', 'memory')
    expect(r.head).toContain('[id:deadbeef]')
    expect(r.body).toBe('body with id')

    r = splitEntryHead('plain body', 'memory')
    expect(r.head).toBe('')
    expect(r.body).toBe('plain body')
  })

  it('daily with project label after time', () => {
    const r = splitEntryHead('[08:30] [myproj] daily content', 'daily')
    expect(r.head).toContain('[08:30]')
    expect(r.head).toContain('[myproj]')
    expect(r.body).toBe('daily content')
  })
})

describe('legacy todo grammar', () => {
  it('TODO constants', () => {
    expect(TODO_HEADER.startsWith('<!--')).toBe(true)
    expect(TODO_HEADER).toContain('§')
    expect(TODO_TARGETS).toEqual(['life', 'work', 'project', 'daily'])
    expect(TODO_STATUSES).toEqual(['pending', 'doing', 'done', 'blocked', 'cancelled'])
  })

  it('parseTodoEntry: parses tag line + content', () => {
    const raw =
      '[2026-08-06 21:30] [id: a1b2c3d4] [q1] [due: 2026-08-10] [status: doing] [cat: life]\nTake mom to hospital'
    const item = parseTodoEntry(raw)
    expect(item).not.toBe(null)
    expect(item!.id).toBe('a1b2c3d4')
    expect(item!.time).toBe('2026-08-06 21:30')
    expect(item!.quadrant).toBe('q1')
    expect(item!.due).toBe('2026-08-10')
    expect(item!.status).toBe('doing')
    expect(item!.cat).toBe('life')
    expect(item!.text).toBe('Take mom to hospital')
  })

  it('parseTodoEntry: handles missing optional tags, defaults', () => {
    const raw = '[2026-08-06 21:30] [id: deadbeef]\nJust content'
    const item = parseTodoEntry(raw)
    expect(item).not.toBe(null)
    expect(item!.id).toBe('deadbeef')
    expect(item!.quadrant).toBe(null)
    expect(item!.due).toBe(null)
    expect(item!.status).toBe('pending')
    expect(item!.cat).toBe(null)
    expect(item!.text).toBe('Just content')
  })

  it('parseTodoEntry: returns null when no timestamp', () => {
    expect(parseTodoEntry('no timestamp [id: deadbeef] content')).toBe(null)
    expect(parseTodoEntry('[q1] [id: deadbeef] content')).toBe(null)
  })

  it('parseTodoEntry: parses multiline content', () => {
    const raw = '[2026-08-06 21:30] [id: abcdef12] [q2]\nLine1\nLine2\nLine3'
    const item = parseTodoEntry(raw)
    expect(item!.text).toBe('Line1\nLine2\nLine3')
  })

  it('parseTodoEntry: handles done timestamp and category with spaces', () => {
    const raw =
      '[2026-08-06 21:30] [id: 12345678] [status: done] [done: 2026-08-07 10:00] [cat: 工作]\nDone task'
    const item = parseTodoEntry(raw)
    expect(item!.status).toBe('done')
    expect(item!.doneAt).toBe('2026-08-07 10:00')
    expect(item!.cat).toBe('工作')
  })

  it('parseTodoEntry: case-insensitive tags, whitespace tolerant', () => {
    const raw = '[2026-08-06 21:30] [ID: A1B2C3D4] [Q2] [Due: 2026-08-15] [Status: Doing]\nContent'
    const item = parseTodoEntry(raw)
    expect(item!.id!.toLowerCase()).toBe('a1b2c3d4')
    expect(item!.quadrant).toBe('q2')
    expect(item!.due).toBe('2026-08-15')
    expect(item!.status).toBe('doing')
  })

  it('stampTodoLine: builds tag line in fixed order, round-trips', () => {
    const meta = {
      time: '2026-08-06 21:30',
      id: 'a1b2c3d4',
      quadrant: 'q1' as const,
      due: '2026-08-10',
      status: 'doing',
      cat: 'life',
      doneAt: null,
    }
    const raw = stampTodoLine(meta, 'Take mom to hospital\nRemember report')
    const parsed = parseTodoEntry(raw)
    expect(parsed!.id).toBe('a1b2c3d4')
    expect(parsed!.quadrant).toBe('q1')
    expect(parsed!.due).toBe('2026-08-10')
    expect(parsed!.status).toBe('doing')
    expect(parsed!.text).toBe('Take mom to hospital\nRemember report')
    expect(raw.startsWith('[2026-08-06 21:30] [id: a1b2c3d4]')).toBe(true)
  })

  it('stampTodoLine: omits optional tags when null, includes doneAt when done', () => {
    const meta = {
      time: '2026-08-06 21:30',
      id: 'deadbeef',
      quadrant: null,
      due: null,
      status: 'pending',
      cat: null,
      doneAt: null,
    }
    const raw = stampTodoLine(meta, 'Simple')
    expect(raw).toBe('[2026-08-06 21:30] [id: deadbeef] [status: pending]\nSimple')
    expect(raw).not.toContain('[q')
    expect(raw).not.toContain('[due:')

    const metaDone = {
      time: '2026-08-06 21:30',
      id: 'deadbeef',
      quadrant: null,
      due: null,
      status: 'done',
      cat: null,
      doneAt: '2026-08-07 10:00',
    }
    const rawDone = stampTodoLine(metaDone, 'Done')
    expect(rawDone).toContain('[done: 2026-08-07 10:00]')
    const parsedDone = parseTodoEntry(rawDone)
    expect(parsedDone!.status).toBe('done')
    expect(parsedDone!.doneAt).toBe('2026-08-07 10:00')
  })

  it('todo delimiter integration: multiple entries split via ENTRY_DELIMITER', () => {
    const e1 = stampTodoLine(
      { time: '2026-08-06 21:30', id: 'aaaa0001', quadrant: 'q1', due: null, status: 'pending', cat: null, doneAt: null },
      'Task A',
    )
    const e2 = stampTodoLine(
      { time: '2026-08-06 21:31', id: 'aaaa0002', quadrant: null, due: '2026-08-10', status: 'pending', cat: null, doneAt: null },
      'Task B',
    )
    const fileText = `${TODO_HEADER}\n§\n${e1}\n§\n${e2}\n`
    const body = fileText
      .replace(/^<!--[\s\S]*?-->\s*/, '')
      .replace(/^\s*§\s*\n?/, '')
      .trim()
    const raws = body.split(ENTRY_DELIMITER).map((s) => s.trim()).filter(Boolean)
    expect(raws.length).toBe(2)
    expect(parseTodoEntry(raws[0])!.text).toBe('Task A')
    expect(parseTodoEntry(raws[1])!.text).toBe('Task B')
  })

  it('handles all quadrants and statuses', () => {
    for (const q of ['q1', 'q2', 'q3', 'q4']) {
      const raw = `[2026-08-06 21:30] [id: aabbccdd] [${q}]\nContent`
      const item = parseTodoEntry(raw)
      expect(item!.quadrant).toBe(q)
    }
    for (const s of ['pending', 'doing', 'done', 'blocked', 'cancelled']) {
      const raw = `[2026-08-06 21:30] [id: aabbccdd] [status: ${s}]\nContent`
      const item = parseTodoEntry(raw)
      expect(item!.status).toBe(s)
    }
  })

  it('ignores unknown tags, preserves raw', () => {
    const raw = '[2026-08-06 21:30] [id: aabbccdd] [unknown: foo] [q1]\nContent'
    const item = parseTodoEntry(raw)
    expect(item!.quadrant).toBe('q1')
    expect(item!.raw).toContain('[unknown: foo]')
  })
})
