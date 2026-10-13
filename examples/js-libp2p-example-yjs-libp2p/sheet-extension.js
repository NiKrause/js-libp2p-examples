/* eslint-disable no-console */

import { UcepError, createProvider } from '@le-space/ucep'
import manifest from './extension-manifest.json'

/**
 * The spreadsheet as a UCEP extension, on the reference library
 * (Le-Space/ucep-js, wire revision 2 of Le-Space/ucep-spec): the manifest,
 * the commands, their arguments by position (a 0.1 consumer such as the UC
 * chat sends `/sheet-show <topic> <cell>`) or as JSON (`{ topic, cell }`),
 * error codes, and — for the one command that rewrites the sheet — a scope
 * a consumer has to pair for.
 */

export const SCOPES = Object.freeze({ write: 'sheet:cells:write' })

/**
 * @param {object} init
 * @param {import('libp2p').Libp2p} init.libp2p
 * @param {import('./spreadsheet-engine.js').SpreadsheetEngine} init.engine
 * @param {Awaited<ReturnType<import('./snapshots.js').startSnapshots>>} init.snapshots
 * @param {string} init.topic the sheet this peer is on
 */
export function createSheetExtension ({ libp2p, engine, snapshots, topic }) {
  let current = topic
  const topics = new Set([topic])

  /** Positional for a 0.1 consumer, named for a 0.2 one. */
  const arg = (ctx, index, key) => {
    const v = ctx.argsJson ? ctx.argsJson[key] : ctx.args[index]
    return v == null ? '' : String(v)
  }

  /** A command names a topic; this peer serves the one sheet it is on. */
  const onTopic = (requested) => {
    if (!requested) throw new UcepError('INVALID_ARGUMENTS', 'a topic is required')
    if (requested !== current) {
      throw new UcepError('UNAVAILABLE', `this peer is on "${current}", not "${requested}"`)
    }
  }

  const cell = (ref) => {
    if (!/^[A-Za-z]+\d+$/.test(ref)) throw new UcepError('INVALID_ARGUMENTS', `not a cell: ${ref}`)
    return ref.toUpperCase()
  }

  const commands = {
    help: {
      syntax: '/sheet-help',
      description: 'The commands, and where the sheet lives',
      handler: () => ({
        name: manifest.name,
        version: manifest.version,
        publicUrl: manifest.publicUrl,
        commands: Object.entries(commands).map(([name, c]) => ({
          name,
          syntax: c.syntax,
          description: c.description,
          scope: c.scope ?? ''
        }))
      })
    },
    show: {
      syntax: '/sheet-show <topic> <cell>',
      description: 'The value of a cell',
      handler: (ctx) => {
        onTopic(arg(ctx, 0, 'topic'))
        const ref = cell(arg(ctx, 1, 'cell'))
        const c = engine.getCell(ref)
        return { topic: current, cell: ref, value: c.value, formula: c.formula ?? null, error: c.error ?? false }
      }
    },
    write: {
      syntax: '/sheet-write <topic> <cell>=<value>',
      description: 'Write a value or a formula into a cell',
      handler: (ctx) => {
        onTopic(arg(ctx, 0, 'topic'))
        let ref, value
        if (ctx.argsJson) {
          ref = cell(arg(ctx, 1, 'cell'))
          value = ctx.argsJson.value
        } else {
          const m = /^([A-Za-z]+\d+)=(.+)$/.exec(ctx.args[1] ?? '')
          if (!m) throw new UcepError('INVALID_ARGUMENTS', 'Usage: /sheet-write <topic> <cell>=<value>')
          ref = cell(m[1])
          value = m[2]
          const n = Number.parseFloat(value)
          if (!value.startsWith('=') && !Number.isNaN(n) && value.trim() === String(n)) value = n
        }
        engine.setCell(ref, value)
        const c = engine.getCell(ref)
        return { topic: current, cell: ref, value: c.value, formula: c.formula ?? null }
      }
    },
    list: {
      syntax: '/sheet-list',
      description: 'The sheets this peer has been on',
      handler: () => ({ topics: [...topics], currentTopic: current })
    },
    snapshot: {
      syntax: '/sheet-snapshot <topic>',
      description: 'Freeze the sheet as it is: its state becomes a block, addressed by its CID',
      handler: async (ctx) => {
        onTopic(arg(ctx, 0, 'topic'))
        return snapshots.take({ by: ctx.peerId })
      }
    },
    snapshots: {
      syntax: '/sheet-snapshots <topic>',
      description: 'The snapshots taken on this sheet, newest first — CID, size, SHA-256, when, by whom',
      handler: (ctx) => {
        onTopic(arg(ctx, 0, 'topic'))
        return { topic: current, snapshots: snapshots.entries() }
      }
    },
    restore: {
      syntax: '/sheet-restore <topic> <cid>',
      description: 'Fetch a snapshot by its CID — verified against it — and put the sheet back to it',
      scope: SCOPES.write,
      handler: async (ctx) => {
        onTopic(arg(ctx, 0, 'topic'))
        const cid = arg(ctx, 1, 'cid')
        if (!cid) throw new UcepError('INVALID_ARGUMENTS', 'Usage: /sheet-restore <topic> <cid>')
        try {
          return { topic: current, cid, ...(await snapshots.restore(cid)) }
        } catch (error) {
          throw new UcepError('UNAVAILABLE', `snapshot not fetched: ${error.message}`)
        }
      }
    }
  }

  const provider = createProvider({
    libp2p,
    manifest: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      publicUrl: manifest.publicUrl,
      icon: manifest.icon,
      scopes: [{ name: SCOPES.write, description: 'Rewrite the sheet: restore a snapshot' }]
    },
    commands
  })

  return {
    provider,
    protocol: provider.protocol,
    /** @param {string} t */
    setCurrentTopic (t) {
      current = t
      topics.add(t)
    },
    start: () => provider.start(),
    stop: () => provider.stop()
  }
}
