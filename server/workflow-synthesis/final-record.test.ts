// @vitest-environment node

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { createFinalRecordPdf, finalRecordPdfFonts, finalRecordPlainText } from './final-record.js'
import type { FinalRecordView } from './repository.js'

const macronTerms = ['Māori', 'whānau', 'kōrero', 'tū', 'wā', 'mātauranga', 'manaakitanga', 'kaitiakitanga', 'pūkenga', 'haepapa', 'oranga', 'whakapapa']
const macronCharacters = ['ā', 'ē', 'ī', 'ō', 'ū', 'Ā', 'Ē', 'Ī', 'Ō', 'Ū']
const fontkit = createRequire(import.meta.url)('fontkit') as {
  openSync(path: string): { glyphForCodePoint(codePoint: number): { id: number } }
}

function finalRecord(overrides: Partial<FinalRecordView> = {}): FinalRecordView {
  return {
    id: 'not-rendered', reference: 'TK-RECORD', organisationName: 'Test organisation', kaimahiDisplayName: 'Test Kaimahi', finalizedAt: new Date('2026-08-18T00:00:00.000Z'),
    overallSummary: 'Confirmed cross-Pou synthesis.', keyThemes: null, strengthsSummary: null, areasForAttentionSummary: null, informationStillToExploreSummary: null, confirmedSafetyConcernsSummary: 'One human-confirmed concern is recorded.',
    actions: [], referrals: [], safetyObservations: [{ context: 'Kaitiakitanga & Risk Management', concernLevel: 'Action required', contextNote: 'Human-confirmed context.' }],
    ...overrides,
  }
}

describe('final record rendering', () => {
  it('renders the immutable canonical safety-observation snapshot without technical identifiers', () => {
    const text = finalRecordPlainText(finalRecord())
    expect(text).toContain('CONFIRMED SAFETY OBSERVATIONS')
    expect(text).toContain('Kaitiakitanga & Risk Management — Action required — Human-confirmed context.')
    expect(text).not.toContain('not-rendered')
  })

  it('preserves Māori macrons and ordinary ASCII in the immutable snapshot text', () => {
    const text = finalRecordPlainText(finalRecord({
      overallSummary: `${macronTerms.join(', ')}. ASCII remains readable.`,
      keyThemes: 'Whānau-centred discussion.',
    }))
    for (const term of macronTerms) expect(text).toContain(term)
    expect(text).toContain('ASCII remains readable.')
  })

  it('bundles glyph coverage for every Māori macron used by the PDF renderer', () => {
    for (const fontPath of Object.values(finalRecordPdfFonts)) {
      const font = fontkit.openSync(fontPath)
      for (const character of macronCharacters) {
        expect(font.glyphForCodePoint(character.codePointAt(0)!).id).toBeGreaterThan(0)
      }
    }
  })

  it('embeds portable Unicode-capable fonts when creating a multipage PDF', async () => {
    const longSummary = `${macronTerms.join(' ')}. `.repeat(320)
    const pdf = await createFinalRecordPdf(finalRecord({
      overallSummary: longSummary,
      keyThemes: longSummary,
      strengthsSummary: longSummary,
      areasForAttentionSummary: longSummary,
      informationStillToExploreSummary: longSummary,
    }))
    const source = pdf.toString('latin1')

    expect(existsSync(finalRecordPdfFonts.regular)).toBe(true)
    expect(existsSync(finalRecordPdfFonts.bold)).toBe(true)
    expect(source.startsWith('%PDF-')).toBe(true)
    expect(source).toContain('NotoSans-')
    expect(source).toContain('/ToUnicode')
    expect(source.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1)
  })

  it('does not add raw transcript-like fields to the copy or PDF export source', async () => {
    const recordWithUnrenderedFields = {
      ...finalRecord({ overallSummary: 'A bounded final summary.' }),
      rawTranscript: 'PRIVATE_TRANSCRIPT_SENTINEL',
      providerPayload: 'PRIVATE_PROVIDER_PAYLOAD_SENTINEL',
    }
    const text = finalRecordPlainText(recordWithUnrenderedFields)
    const pdf = await createFinalRecordPdf(recordWithUnrenderedFields)

    expect(text).not.toContain('PRIVATE_TRANSCRIPT_SENTINEL')
    expect(text).not.toContain('PRIVATE_PROVIDER_PAYLOAD_SENTINEL')
    expect(pdf.byteLength).toBeGreaterThan(0)
  })
})
