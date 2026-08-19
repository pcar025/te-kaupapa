import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

type RuntimeService = {
  name: 'Fastify' | 'webhook relay' | 'Vite frontend'
  port: number
  commandFragment: string
}

type Listener = { pid: number; command: string; address: string }

const requiredServices: RuntimeService[] = [
  { name: 'Fastify', port: 3011, commandFragment: 'server/index.ts' },
  { name: 'webhook relay', port: 3012, commandFragment: 'relay-elevenlabs-webhook.ts' },
  { name: 'Vite frontend', port: 8443, commandFragment: 'vite' },
]

export type RuntimeCommand = (command: string, args: string[]) => string

const run: RuntimeCommand = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export function listenersFromLsof(output: string, commands: Map<number, string>): Listener[] {
  const records = output.split('\n').filter(Boolean)
  const listeners: Listener[] = []
  let pid: number | undefined
  for (const record of records) {
    const kind = record[0]
    const value = record.slice(1)
    if (kind === 'p') {
      pid = Number(value)
      continue
    }
    if (kind !== 'n' || !pid) continue
    // `lsof -Fpn` omits the human-readable TCP/(LISTEN) wrappers because the
    // command is already filtered to listening TCP sockets.
    const address = value.replace(/^TCP\s+/, '').replace(/\s+\(LISTEN\)$/, '')
    listeners.push({ pid, address, command: commands.get(pid) ?? '' })
  }
  return listeners
}

export function checkLocalLiveRuntime(command: RuntimeCommand = run): string[] {
  const failures: string[] = []
  for (const service of requiredServices) {
    let output = ''
    try {
      output = command('lsof', ['-nP', `-iTCP:${service.port}`, '-sTCP:LISTEN', '-Fpn'])
    } catch {
      failures.push(`${service.name} on ${service.port}: no listener found.`)
      continue
    }
    const pids = [...new Set([...output.matchAll(/^p(\d+)$/gm)].map((match) => Number(match[1])))]
    const commands = new Map<number, string>()
    for (const pid of pids) {
      try {
        commands.set(pid, command('ps', ['-p', String(pid), '-o', 'command=']).trim())
      } catch {
        commands.set(pid, '')
      }
    }
    const listeners = listenersFromLsof(output, commands)
    const valid = listeners.filter((listener) => listener.address === `127.0.0.1:${service.port}` && listener.command.includes(service.commandFragment))
    if (listeners.length !== 1 || valid.length !== 1) {
      const found = listeners.length ? listeners.map((listener) => `PID ${listener.pid} ${listener.address} ${listener.command || '(command unavailable)'}`).join('; ') : 'none'
      failures.push(`${service.name} on ${service.port}: expected exactly one 127.0.0.1 listener running ${service.commandFragment}; found ${found}.`)
    }
  }
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = checkLocalLiveRuntime()
  if (failures.length) {
    process.stderr.write(`Local live-test runtime preflight failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}\nStop or restart only the identified Te Kaupapa process, then rerun this command.\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('Local live-test runtime preflight passed: Fastify, webhook relay, and Vite each have one approved loopback listener.\n')
  }
}
