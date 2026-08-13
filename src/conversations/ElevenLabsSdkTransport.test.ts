import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

describe('installed ElevenLabs private WebRTC transport', () => {
  it('serializes server-authorized dynamic variables into LiveKit conversation initiation client data', async () => {
    const guidance = 'g'.repeat(256)
    const sdkRoot = path.resolve(process.cwd(), 'node_modules/@elevenlabs/client/dist/utils')
    const overridesUrl = pathToFileURL(path.join(sdkRoot, 'overrides.js')).href
    const { constructOverrides } = await import(overridesUrl) as { constructOverrides: (options: object) => unknown }
    const event = constructOverrides({
      connectionType: 'webrtc',
      conversationToken: 'synthetic-test-token',
      dynamicVariables: { pou_name: 'Whakapapa', pou_guidance: guidance },
    }) as { type: string; dynamic_variables: Record<string, string> }
    const webRtcSource = await readFile(path.join(sdkRoot, 'WebRTCConnection.js'), 'utf8')

    expect(event.type).toBe('conversation_initiation_client_data')
    expect(Object.keys(event.dynamic_variables).sort()).toEqual(['pou_guidance', 'pou_name'])
    expect(event.dynamic_variables.pou_name).toBe('Whakapapa')
    expect(event.dynamic_variables.pou_guidance).toHaveLength(guidance.length)
    expect(sha256(event.dynamic_variables.pou_guidance)).toBe(sha256(guidance))
    expect(webRtcSource).toMatch(/const overridesEvent = constructOverrides\(config\)[\s\S]*?await connection\.sendMessage\(overridesEvent\)/)
    expect(webRtcSource.indexOf('await room.connect(livekitUrl, conversationToken)')).toBeLessThan(webRtcSource.indexOf('await connection.sendMessage(overridesEvent)'))
  })
})
