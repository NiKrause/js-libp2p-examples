import { lpStream } from '@libp2p/utils'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'

/**
 * JSON over a length-prefixed libp2p stream.
 *
 * libp2p v3 turned streams into EventTargets and ships `lpStream`, which reads
 * and writes whole length-prefixed messages imperatively. That replaces
 * everything this file used to do by hand: picking a source between
 * `stream.source`, the stream itself and `incomingData`, writing through
 * `stream.sink`, and the separate WebRTC path that reached past libp2p into
 * `stream.channel.send()` with its own open-wait and a 100 ms sleep after every
 * write. Those branches existed because the v2 stream shape differed per
 * transport; in v3 it does not, so a WebRTC stream and a muxed stream are
 * written the same way.
 *
 * @param {any} stream libp2p stream
 * @param {{ timeoutMs?: number }} [options]
 */
export function jsonStream (stream, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000
  const lp = lpStream(stream)
  let closed = false

  // Every read and write is bounded. A peer that opens a stream and then says
  // nothing used to hang the caller forever.
  const signal = () => AbortSignal.timeout(timeoutMs)

  return {
    async write (data) {
      if (closed) {
        throw new Error('Stream is closed')
      }

      await lp.write(uint8ArrayFromString(JSON.stringify(data)), { signal: signal() })
    },

    async read () {
      const message = await lp.read({ signal: signal() })

      if (message == null) {
        throw new Error('Stream ended before response')
      }

      return JSON.parse(uint8ArrayToString(message.subarray()))
    },

    async close () {
      if (closed) return
      closed = true

      try {
        await stream.close()
      } catch {
        // A stream the other side already dropped throws here; nothing to do.
      }
    }
  }
}
