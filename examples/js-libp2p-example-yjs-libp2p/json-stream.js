import * as lp from 'it-length-prefixed'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'

/**
 * Simple JSON stream wrapper for libp2p streams
 * Handles WebRTC streams which use channel.send() for writing
 */

/**
 * Wrap a libp2p stream for JSON read/write with length-prefixing
 * @param {any} stream - libp2p stream
 * @returns {{write: Function, read: Function, close: Function}}
 */
export function jsonStream (stream) {
  // Debug the stream shape once to understand available properties
  try {
    console.log('jsonStream (ext): stream keys:', Object.keys(stream || {}))
    console.log('jsonStream (ext): typeof stream.sink:', typeof stream?.sink)
    console.log('jsonStream (ext): typeof stream.source:', typeof stream?.source)
    console.log('jsonStream (ext): has incomingData:', 'incomingData' in (stream || {}))
    console.log('jsonStream (ext): has channel:', 'channel' in (stream || {}))
  } catch {
    // ignore logging issues
  }

  // Prefer async-iterable stream; fall back to incomingData
  const useStream = (stream && typeof stream[Symbol.asyncIterator] === 'function')
  const source =
    stream?.source ??
    (useStream ? stream : stream?.incomingData)

  if (!source) {
    throw new Error('jsonStream: no readable source found on stream')
  }

  try {
    console.log('jsonStream (ext): using source type:', typeof source, 'via', useStream ? 'stream asyncIterable' : 'incomingData')
  } catch {
    // ignore logging issues
  }

  // Create an async iterator for reading from source with length-prefix decoding
  const readIterator = lp.decode(source)[Symbol.asyncIterator]()

  let closed = false

  // Detect if this is a WebRTC stream with a channel
  const isWebRTC = stream?.channel && typeof stream.channel.send === 'function'

  return {
    async write (data) {
      if (closed) {
        throw new Error('Stream is closed')
      }

      const jsonBytes = uint8ArrayFromString(JSON.stringify(data))
      // Encode with length prefix
      const encoded = lp.encode.single(jsonBytes).subarray()

      // Prefer sink when available (muxed libp2p stream)
      if (typeof stream.sink === 'function') {
        async function * singleMessage () {
          yield encoded
        }
        await stream.sink(singleMessage())
        return
      }

      // Fallback: WebRTC channel
      if (isWebRTC && stream.channel && typeof stream.channel.send === 'function') {
        const channel = stream.channel

        if (channel.binaryType !== 'arraybuffer') {
          channel.binaryType = 'arraybuffer'
        }

        if (channel.readyState !== 'open') {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Channel open timeout')), 5000)
            channel.onopen = () => {
              clearTimeout(timeout)
              resolve()
            }
            channel.onerror = (err) => {
              clearTimeout(timeout)
              reject(err)
            }
          })
        }

        channel.send(encoded)
        await new Promise(resolve => setTimeout(resolve, 100))
        return
      }

      // Last fallback: pushable-style
      if (stream.push && typeof stream.push === 'function') {
        stream.push(encoded)
        await new Promise(resolve => setTimeout(resolve, 100))
        return
      }

      console.error('jsonStream: No suitable write method found')
      console.error('jsonStream: Available properties:', Object.keys(stream || {}))
      throw new Error('Cannot write to stream - no suitable method found')
    },

    async read () {
      const result = await readIterator.next()

      if (result.done) {
        throw new Error('Stream ended before response')
      }

      const rawData = result.value.subarray ? result.value.subarray() : result.value
      return JSON.parse(uint8ArrayToString(rawData))
    },

    async close () {
      if (closed) return
      closed = true

      try {
        if (typeof stream.close === 'function') {
          await stream.close()
        } else if (isWebRTC && stream.channel) {
          stream.channel.close()
        }
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}
