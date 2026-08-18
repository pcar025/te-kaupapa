import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import PDFDocument from 'pdfkit'

import type { FinalRecordView } from './repository.js'

function bundledFontPath(filename: string): string {
  const relativePath = `./fonts/${filename}`
  // The server loads this module from a file URL. Vitest serves source modules
  // with a local HTTP URL, so use the repository-relative source location only
  // for that test runner environment.
  return import.meta.url.startsWith('file:')
    ? fileURLToPath(new URL(relativePath, import.meta.url))
    : resolve(process.cwd(), 'server', 'workflow-synthesis', 'fonts', filename)
}

// These application-owned fonts are embedded in every exported PDF. PDFKit's
// built-in Helvetica uses a legacy single-byte encoding and cannot faithfully
// render te reo Māori macrons.
export const finalRecordPdfFonts = {
  regular: bundledFontPath('NotoSans-Regular.ttf'),
  bold: bundledFontPath('NotoSans-Bold.ttf'),
} as const

function linesFor(values: string[]): string {
  return values.length ? values.map((value) => `• ${value}`).join('\n') : 'None recorded.'
}

export function finalRecordPlainText(record: FinalRecordView): string {
  const sections: Array<[string, string | null]> = [
    ['TE KAUPAPA FINAL RECORD', `${record.reference}\n${record.organisationName}\nPrepared by ${record.kaimahiDisplayName}\nFinalised ${record.finalizedAt.toISOString()}`],
    ['ENGAGEMENT SUMMARY', record.overallSummary],
    ['KEY THEMES', record.keyThemes],
    ['STRENGTHS AND PROTECTIVE FACTORS', record.strengthsSummary],
    ['AREAS REQUIRING ATTENTION', record.areasForAttentionSummary],
    ['INFORMATION STILL TO EXPLORE', record.informationStillToExploreSummary],
    ['CONFIRMED SAFETY CONCERNS', record.confirmedSafetyConcernsSummary],
    ['CONFIRMED SAFETY OBSERVATIONS', linesFor(record.safetyObservations.map((item) => [item.context, item.concernLevel, item.contextNote].filter(Boolean).join(' — ')))],
    ['ACTIONS / FOLLOW-UP', linesFor(record.actions.map((item) => [item.pouName, item.title, item.status, item.dueDate ? `due ${item.dueDate}` : null].filter(Boolean).join(' — ')))],
    ['REFERRALS', linesFor(record.referrals.map((item) => [item.pouName, item.destinationName, item.reason, item.status].filter(Boolean).join(' — ')))],
  ]
  return sections.filter(([, content]) => content).map(([heading, content]) => `${heading}\n${content}`).join('\n\n')
}

export function createFinalRecordPdf(record: FinalRecordView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Te Kaupapa final record ${record.reference}`, Author: 'Te Kaupapa' } })
    const chunks: Buffer[] = []
    document.on('data', (chunk: Buffer) => chunks.push(chunk))
    document.on('error', reject)
    document.on('end', () => resolve(Buffer.concat(chunks)))
    document.registerFont('TeKaupapaNotoSans', finalRecordPdfFonts.regular)
    document.registerFont('TeKaupapaNotoSansBold', finalRecordPdfFonts.bold)
    const sections = finalRecordPlainText(record).split('\n\n')
    sections.forEach((section, index) => {
      const [heading, ...content] = section.split('\n')
      document.font('TeKaupapaNotoSansBold').fontSize(index === 0 ? 16 : 10).fillColor('#25352b').text(heading ?? '')
      document.moveDown(0.35).font('TeKaupapaNotoSans').fontSize(10).fillColor('#27302a').text(content.join('\n'), { lineGap: 2 })
      document.moveDown(0.85)
    })
    document.end()
  })
}
