import { decodeMessage, encodeMessage, enumeration, message, streamMessage } from 'protons-runtime'
import type { Codec, DecodeOptions } from 'protons-runtime'
import type { Uint8ArrayList } from 'uint8arraylist'

export interface dmInput {}

export interface dm {}

export namespace dm {
  export interface Metadata {
    clientVersion: string
    timestamp: bigint
  }

  export interface MetadataInput {
    clientVersion?: string
    timestamp?: bigint
  }

  export namespace Metadata {
    let _codec: Codec<Metadata, MetadataInput>

    export const codec = (): Codec<Metadata, MetadataInput> => {
      if (_codec == null) {
        _codec = message<Metadata, MetadataInput>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if ((obj.clientVersion != null && obj.clientVersion !== '')) {
            w.uint32(10)
            w.string(obj.clientVersion)
          }

          if ((obj.timestamp != null && obj.timestamp !== 0n)) {
            w.uint32(16)
            w.int64(obj.timestamp)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (r, length) => {
          const obj: any = {
            clientVersion: '',
            timestamp: 0n
          }

          const end = length == null ? r.len : r.pos + length

          while (r.pos < end) {
            const tag = r.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.clientVersion = r.string()
                break
              }
              case 2: {
                obj.timestamp = r.int64()
                break
              }
              default: {
                r.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        }, function * (r, length, prefix) {
          const end = length == null ? r.len : r.pos + length

          if (prefix !== '.') {
            yield {
              field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
              type: 'start',
              message: 'dm.Metadata'
            }
          }

          while (r.pos < end) {
            const tag = r.uint32()

            switch (tag >>> 3) {
              case 1: {
                yield {
                  field: `${prefix}clientVersion`,
                  value: r.string()
                }
                break
              }
              case 2: {
                yield {
                  field: `${prefix}timestamp`,
                  value: r.int64()
                }
                break
              }
              default: {
                r.skipType(tag & 7)
                break
              }
            }
          }

          if (prefix !== '.') {
            yield {
              field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
              type: 'end',
              message: 'dm.Metadata'
            }
          }
        })
      }

      return _codec
    }

    export interface MetadataClientVersionFieldEvent {
      field: '.clientVersion'
      value: string
    }

    export interface MetadataTimestampFieldEvent {
      field: '.timestamp'
      value: bigint
    }

    export function encode (obj: MetadataInput): Uint8Array<ArrayBuffer> {
      return encodeMessage(obj, Metadata.codec())
    }

    export function decode (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<Metadata>): Metadata {
      return decodeMessage(buf, Metadata.codec(), opts)
    }

    export function stream (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<Metadata>): Generator<MetadataClientVersionFieldEvent | MetadataTimestampFieldEvent> {
      return streamMessage(buf, Metadata.codec(), opts)
    }
  }

  export enum Status {
    UNKNOWN = 'UNKNOWN',
    OK = 'OK',
    ERROR = 'ERROR'
  }

  enum __StatusValues {
    UNKNOWN = 0,
    OK = 200,
    ERROR = 500
  }

  export namespace Status {
    export const codec = (): Codec<Status, Status> => {
      return enumeration<Status>(__StatusValues)
    }
  }

  export interface DirectMessageRequest {
    metadata?: dm.Metadata
    content: string
    type: string
  }

  export interface DirectMessageRequestInput {
    metadata?: dm.MetadataInput
    content?: string
    type?: string
  }

  export namespace DirectMessageRequest {
    let _codec: Codec<DirectMessageRequest, DirectMessageRequestInput>

    export const codec = (): Codec<DirectMessageRequest, DirectMessageRequestInput> => {
      if (_codec == null) {
        _codec = message<DirectMessageRequest, DirectMessageRequestInput>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if (obj.metadata != null) {
            w.uint32(10)
            dm.Metadata.codec().encode(obj.metadata, w)
          }

          if ((obj.content != null && obj.content !== '')) {
            w.uint32(18)
            w.string(obj.content)
          }

          if ((obj.type != null && obj.type !== '')) {
            w.uint32(26)
            w.string(obj.type)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (r, length, opts = {}) => {
          const obj: any = {
            content: '',
            type: ''
          }

          const end = length == null ? r.len : r.pos + length

          while (r.pos < end) {
            const tag = r.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.metadata = dm.Metadata.codec().decode(r, r.uint32(), {
                  limits: opts.limits?.metadata
                })
                break
              }
              case 2: {
                obj.content = r.string()
                break
              }
              case 3: {
                obj.type = r.string()
                break
              }
              default: {
                r.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        }, function * (r, length, prefix, opts = {}) {
          const end = length == null ? r.len : r.pos + length

          if (prefix !== '.') {
            yield {
              field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
              type: 'start',
              message: 'dm.DirectMessageRequest'
            }
          }

          while (r.pos < end) {
            const tag = r.uint32()

            switch (tag >>> 3) {
              case 1: {
                yield * dm.Metadata.codec().stream(r, r.uint32(), `${prefix}metadata.`, {
                  limits: opts.limits?.metadata
                })

                break
              }
              case 2: {
                yield {
                  field: `${prefix}content`,
                  value: r.string()
                }
                break
              }
              case 3: {
                yield {
                  field: `${prefix}type`,
                  value: r.string()
                }
                break
              }
              default: {
                r.skipType(tag & 7)
                break
              }
            }
          }

          if (prefix !== '.') {
            yield {
              field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
              type: 'end',
              message: 'dm.DirectMessageRequest'
            }
          }
        })
      }

      return _codec
    }

    export interface DirectMessageRequestMetadataMessageStart {
      field: '.metadata'
      type: 'start'
    }

    export interface DirectMessageRequestMetadataMessageEnd {
      field: '.metadata'
      type: 'end'
    }

    export interface DirectMessageRequestMetadataClientVersionFieldEvent {
      field: '.metadata.clientVersion'
      value: string
    }

    export interface DirectMessageRequestMetadataTimestampFieldEvent {
      field: '.metadata.timestamp'
      value: bigint
    }

    export interface DirectMessageRequestContentFieldEvent {
      field: '.content'
      value: string
    }

    export interface DirectMessageRequestTypeFieldEvent {
      field: '.type'
      value: string
    }

    export function encode (obj: DirectMessageRequestInput): Uint8Array<ArrayBuffer> {
      return encodeMessage(obj, DirectMessageRequest.codec())
    }

    export function decode (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<DirectMessageRequest>): DirectMessageRequest {
      return decodeMessage(buf, DirectMessageRequest.codec(), opts)
    }

    export function stream (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<DirectMessageRequest>): Generator<DirectMessageRequestMetadataMessageStart | DirectMessageRequestMetadataMessageEnd | DirectMessageRequestMetadataClientVersionFieldEvent | DirectMessageRequestMetadataTimestampFieldEvent | DirectMessageRequestContentFieldEvent | DirectMessageRequestTypeFieldEvent> {
      return streamMessage(buf, DirectMessageRequest.codec(), opts)
    }
  }

  export interface DirectMessageResponse {
    metadata?: dm.Metadata
    status: dm.Status
    statusText?: string
  }

  export interface DirectMessageResponseInput {
    metadata?: dm.MetadataInput
    status?: dm.Status
    statusText?: string
  }

  export namespace DirectMessageResponse {
    let _codec: Codec<DirectMessageResponse, DirectMessageResponseInput>

    export const codec = (): Codec<DirectMessageResponse, DirectMessageResponseInput> => {
      if (_codec == null) {
        _codec = message<DirectMessageResponse, DirectMessageResponseInput>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if (obj.metadata != null) {
            w.uint32(10)
            dm.Metadata.codec().encode(obj.metadata, w)
          }

          if (obj.status != null && __StatusValues[obj.status] !== 0) {
            w.uint32(16)
            dm.Status.codec().encode(obj.status, w)
          }

          if (obj.statusText != null) {
            w.uint32(26)
            w.string(obj.statusText)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (r, length, opts = {}) => {
          const obj: any = {
            status: Status.UNKNOWN
          }

          const end = length == null ? r.len : r.pos + length

          while (r.pos < end) {
            const tag = r.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.metadata = dm.Metadata.codec().decode(r, r.uint32(), {
                  limits: opts.limits?.metadata
                })
                break
              }
              case 2: {
                obj.status = dm.Status.codec().decode(r)
                break
              }
              case 3: {
                obj.statusText = r.string()
                break
              }
              default: {
                r.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        }, function * (r, length, prefix, opts = {}) {
          const end = length == null ? r.len : r.pos + length

          if (prefix !== '.') {
            yield {
              field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
              type: 'start',
              message: 'dm.DirectMessageResponse'
            }
          }

          while (r.pos < end) {
            const tag = r.uint32()

            switch (tag >>> 3) {
              case 1: {
                yield * dm.Metadata.codec().stream(r, r.uint32(), `${prefix}metadata.`, {
                  limits: opts.limits?.metadata
                })

                break
              }
              case 2: {
                yield {
                  field: `${prefix}status`,
                  value: dm.Status.codec().decode(r)
                }
                break
              }
              case 3: {
                yield {
                  field: `${prefix}statusText`,
                  value: r.string()
                }
                break
              }
              default: {
                r.skipType(tag & 7)
                break
              }
            }
          }

          if (prefix !== '.') {
            yield {
              field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
              type: 'end',
              message: 'dm.DirectMessageResponse'
            }
          }
        })
      }

      return _codec
    }

    export interface DirectMessageResponseMetadataMessageStart {
      field: '.metadata'
      type: 'start'
    }

    export interface DirectMessageResponseMetadataMessageEnd {
      field: '.metadata'
      type: 'end'
    }

    export interface DirectMessageResponseMetadataClientVersionFieldEvent {
      field: '.metadata.clientVersion'
      value: string
    }

    export interface DirectMessageResponseMetadataTimestampFieldEvent {
      field: '.metadata.timestamp'
      value: bigint
    }

    export interface DirectMessageResponseStatusFieldEvent {
      field: '.status'
      value: dm.Status
    }

    export interface DirectMessageResponseStatusTextFieldEvent {
      field: '.statusText'
      value: string
    }

    export function encode (obj: DirectMessageResponseInput): Uint8Array<ArrayBuffer> {
      return encodeMessage(obj, DirectMessageResponse.codec())
    }

    export function decode (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<DirectMessageResponse>): DirectMessageResponse {
      return decodeMessage(buf, DirectMessageResponse.codec(), opts)
    }

    export function stream (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<DirectMessageResponse>): Generator<DirectMessageResponseMetadataMessageStart | DirectMessageResponseMetadataMessageEnd | DirectMessageResponseMetadataClientVersionFieldEvent | DirectMessageResponseMetadataTimestampFieldEvent | DirectMessageResponseStatusFieldEvent | DirectMessageResponseStatusTextFieldEvent> {
      return streamMessage(buf, DirectMessageResponse.codec(), opts)
    }
  }

  let _codec: Codec<dm, dmInput>

  export const codec = (): Codec<dm, dmInput> => {
    if (_codec == null) {
      _codec = message<dm, dmInput>((obj, w, opts = {}) => {
        if (opts.lengthDelimited !== false) {
          w.fork()
        }

        if (opts.lengthDelimited !== false) {
          w.ldelim()
        }
      }, (r, length) => {
        const obj: any = {}

        const end = length == null ? r.len : r.pos + length

        while (r.pos < end) {
          const tag = r.uint32()

          switch (tag >>> 3) {
            default: {
              r.skipType(tag & 7)
              break
            }
          }
        }

        return obj
      }, function * (r, length, prefix) {
        const end = length == null ? r.len : r.pos + length

        if (prefix !== '.') {
          yield {
            field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
            type: 'start',
            message: 'dm'
          }
        }

        while (r.pos < end) {
          const tag = r.uint32()

          switch (tag >>> 3) {
            default: {
              r.skipType(tag & 7)
              break
            }
          }
        }

        if (prefix !== '.') {
          yield {
            field: prefix.endsWith('.') ? prefix.substring(0, prefix.length - 1) : prefix,
            type: 'end',
            message: 'dm'
          }
        }
      })
    }

    return _codec
  }

  export function encode (obj: dmInput): Uint8Array<ArrayBuffer> {
    return encodeMessage(obj, dm.codec())
  }

  export function decode (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<dm>): dm {
    return decodeMessage(buf, dm.codec(), opts)
  }

  export function stream (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<dm>): Generator<{}> {
    return streamMessage(buf, dm.codec(), opts)
  }
}
