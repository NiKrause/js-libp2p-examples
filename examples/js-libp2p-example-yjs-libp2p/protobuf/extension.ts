/* eslint-disable import/export */
/* eslint-disable complexity */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/no-unnecessary-boolean-literal-compare */
/* eslint-disable @typescript-eslint/no-empty-interface */
/* eslint-disable import/consistent-type-specifier-style */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { decodeMessage, encodeMessage, MaxLengthError, message } from 'protons-runtime'
import type { Codec, DecodeOptions } from 'protons-runtime'
import type { Uint8ArrayList } from 'uint8arraylist'

export interface ext {}

export namespace ext {
  export interface ExtensionManifest {
    id: string
    name: string
    version: string
    description: string
    author: string
    publicUrl: string
    commands: ext.ExtensionCommand[]
    icon: string
  }

  export namespace ExtensionManifest {
    let _codec: Codec<ExtensionManifest>

    export const codec = (): Codec<ExtensionManifest> => {
      if (_codec == null) {
        _codec = message<ExtensionManifest>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if ((obj.id != null && obj.id !== '')) {
            w.uint32(10)
            w.string(obj.id)
          }

          if ((obj.name != null && obj.name !== '')) {
            w.uint32(18)
            w.string(obj.name)
          }

          if ((obj.version != null && obj.version !== '')) {
            w.uint32(26)
            w.string(obj.version)
          }

          if ((obj.description != null && obj.description !== '')) {
            w.uint32(34)
            w.string(obj.description)
          }

          if ((obj.author != null && obj.author !== '')) {
            w.uint32(42)
            w.string(obj.author)
          }

          if ((obj.publicUrl != null && obj.publicUrl !== '')) {
            w.uint32(50)
            w.string(obj.publicUrl)
          }

          if (obj.commands != null) {
            for (const value of obj.commands) {
              w.uint32(58)
              ext.ExtensionCommand.codec().encode(value, w)
            }
          }

          if ((obj.icon != null && obj.icon !== '')) {
            w.uint32(66)
            w.string(obj.icon)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {
            id: '',
            name: '',
            version: '',
            description: '',
            author: '',
            publicUrl: '',
            commands: [],
            icon: ''
          }

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.id = reader.string()
                break
              }
              case 2: {
                obj.name = reader.string()
                break
              }
              case 3: {
                obj.version = reader.string()
                break
              }
              case 4: {
                obj.description = reader.string()
                break
              }
              case 5: {
                obj.author = reader.string()
                break
              }
              case 6: {
                obj.publicUrl = reader.string()
                break
              }
              case 7: {
                if (opts.limits?.commands != null && obj.commands.length === opts.limits.commands) {
                  throw new MaxLengthError('Decode error - map field "commands" had too many elements')
                }

                obj.commands.push(ext.ExtensionCommand.codec().decode(reader, reader.uint32(), {
                  limits: opts.limits?.commands$
                }))
                break
              }
              case 8: {
                obj.icon = reader.string()
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<ExtensionManifest>): Uint8Array => {
      return encodeMessage(obj, ExtensionManifest.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<ExtensionManifest>): ExtensionManifest => {
      return decodeMessage(buf, ExtensionManifest.codec(), opts)
    }
  }

  export interface ExtensionCommand {
    name: string
    syntax: string
    description: string
  }

  export namespace ExtensionCommand {
    let _codec: Codec<ExtensionCommand>

    export const codec = (): Codec<ExtensionCommand> => {
      if (_codec == null) {
        _codec = message<ExtensionCommand>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if ((obj.name != null && obj.name !== '')) {
            w.uint32(10)
            w.string(obj.name)
          }

          if ((obj.syntax != null && obj.syntax !== '')) {
            w.uint32(18)
            w.string(obj.syntax)
          }

          if ((obj.description != null && obj.description !== '')) {
            w.uint32(26)
            w.string(obj.description)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {
            name: '',
            syntax: '',
            description: ''
          }

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.name = reader.string()
                break
              }
              case 2: {
                obj.syntax = reader.string()
                break
              }
              case 3: {
                obj.description = reader.string()
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<ExtensionCommand>): Uint8Array => {
      return encodeMessage(obj, ExtensionCommand.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<ExtensionCommand>): ExtensionCommand => {
      return decodeMessage(buf, ExtensionCommand.codec(), opts)
    }
  }

  export interface Request {
    manifest?: ext.ManifestRequest
    command?: ext.CommandRequest
  }

  export namespace Request {
    let _codec: Codec<Request>

    export const codec = (): Codec<Request> => {
      if (_codec == null) {
        _codec = message<Request>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          obj = { ...obj }

          if (obj.command != null) {
            obj.manifest = undefined
          }

          if (obj.manifest != null) {
            obj.command = undefined
          }

          if (obj.manifest != null) {
            w.uint32(10)
            ext.ManifestRequest.codec().encode(obj.manifest, w)
          }

          if (obj.command != null) {
            w.uint32(18)
            ext.CommandRequest.codec().encode(obj.command, w)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {}

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.manifest = ext.ManifestRequest.codec().decode(reader, reader.uint32(), {
                  limits: opts.limits?.manifest
                })
                break
              }
              case 2: {
                obj.command = ext.CommandRequest.codec().decode(reader, reader.uint32(), {
                  limits: opts.limits?.command
                })
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          if (obj.command != null) {
            delete obj.manifest
          }

          if (obj.manifest != null) {
            delete obj.command
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<Request>): Uint8Array => {
      return encodeMessage(obj, Request.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<Request>): Request => {
      return decodeMessage(buf, Request.codec(), opts)
    }
  }

  export interface Response {
    manifest?: ext.ManifestResponse
    command?: ext.CommandResponse
  }

  export namespace Response {
    let _codec: Codec<Response>

    export const codec = (): Codec<Response> => {
      if (_codec == null) {
        _codec = message<Response>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          obj = { ...obj }

          if (obj.command != null) {
            obj.manifest = undefined
          }

          if (obj.manifest != null) {
            obj.command = undefined
          }

          if (obj.manifest != null) {
            w.uint32(10)
            ext.ManifestResponse.codec().encode(obj.manifest, w)
          }

          if (obj.command != null) {
            w.uint32(18)
            ext.CommandResponse.codec().encode(obj.command, w)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {}

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.manifest = ext.ManifestResponse.codec().decode(reader, reader.uint32(), {
                  limits: opts.limits?.manifest
                })
                break
              }
              case 2: {
                obj.command = ext.CommandResponse.codec().decode(reader, reader.uint32(), {
                  limits: opts.limits?.command
                })
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          if (obj.command != null) {
            delete obj.manifest
          }

          if (obj.manifest != null) {
            delete obj.command
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<Response>): Uint8Array => {
      return encodeMessage(obj, Response.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<Response>): Response => {
      return decodeMessage(buf, Response.codec(), opts)
    }
  }

  export interface ManifestRequest {
    timestamp: bigint
  }

  export namespace ManifestRequest {
    let _codec: Codec<ManifestRequest>

    export const codec = (): Codec<ManifestRequest> => {
      if (_codec == null) {
        _codec = message<ManifestRequest>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if ((obj.timestamp != null && obj.timestamp !== 0n)) {
            w.uint32(8)
            w.int64(obj.timestamp)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {
            timestamp: 0n
          }

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.timestamp = reader.int64()
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<ManifestRequest>): Uint8Array => {
      return encodeMessage(obj, ManifestRequest.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<ManifestRequest>): ManifestRequest => {
      return decodeMessage(buf, ManifestRequest.codec(), opts)
    }
  }

  export interface ManifestResponse {
    manifest?: ext.ExtensionManifest
    timestamp: bigint
  }

  export namespace ManifestResponse {
    let _codec: Codec<ManifestResponse>

    export const codec = (): Codec<ManifestResponse> => {
      if (_codec == null) {
        _codec = message<ManifestResponse>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if (obj.manifest != null) {
            w.uint32(10)
            ext.ExtensionManifest.codec().encode(obj.manifest, w)
          }

          if ((obj.timestamp != null && obj.timestamp !== 0n)) {
            w.uint32(16)
            w.int64(obj.timestamp)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {
            timestamp: 0n
          }

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.manifest = ext.ExtensionManifest.codec().decode(reader, reader.uint32(), {
                  limits: opts.limits?.manifest
                })
                break
              }
              case 2: {
                obj.timestamp = reader.int64()
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<ManifestResponse>): Uint8Array => {
      return encodeMessage(obj, ManifestResponse.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<ManifestResponse>): ManifestResponse => {
      return decodeMessage(buf, ManifestResponse.codec(), opts)
    }
  }

  export interface CommandRequest {
    requestId: string
    extensionId: string
    command: string
    args: string[]
    timestamp: bigint
  }

  export namespace CommandRequest {
    let _codec: Codec<CommandRequest>

    export const codec = (): Codec<CommandRequest> => {
      if (_codec == null) {
        _codec = message<CommandRequest>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if ((obj.requestId != null && obj.requestId !== '')) {
            w.uint32(10)
            w.string(obj.requestId)
          }

          if ((obj.extensionId != null && obj.extensionId !== '')) {
            w.uint32(18)
            w.string(obj.extensionId)
          }

          if ((obj.command != null && obj.command !== '')) {
            w.uint32(26)
            w.string(obj.command)
          }

          if (obj.args != null) {
            for (const value of obj.args) {
              w.uint32(34)
              w.string(value)
            }
          }

          if ((obj.timestamp != null && obj.timestamp !== 0n)) {
            w.uint32(40)
            w.int64(obj.timestamp)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {
            requestId: '',
            extensionId: '',
            command: '',
            args: [],
            timestamp: 0n
          }

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.requestId = reader.string()
                break
              }
              case 2: {
                obj.extensionId = reader.string()
                break
              }
              case 3: {
                obj.command = reader.string()
                break
              }
              case 4: {
                if (opts.limits?.args != null && obj.args.length === opts.limits.args) {
                  throw new MaxLengthError('Decode error - map field "args" had too many elements')
                }

                obj.args.push(reader.string())
                break
              }
              case 5: {
                obj.timestamp = reader.int64()
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<CommandRequest>): Uint8Array => {
      return encodeMessage(obj, CommandRequest.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<CommandRequest>): CommandRequest => {
      return decodeMessage(buf, CommandRequest.codec(), opts)
    }
  }

  export interface CommandResponse {
    requestId: string
    success: boolean
    data?: string
    error?: string
    timestamp: bigint
  }

  export namespace CommandResponse {
    let _codec: Codec<CommandResponse>

    export const codec = (): Codec<CommandResponse> => {
      if (_codec == null) {
        _codec = message<CommandResponse>((obj, w, opts = {}) => {
          if (opts.lengthDelimited !== false) {
            w.fork()
          }

          if ((obj.requestId != null && obj.requestId !== '')) {
            w.uint32(10)
            w.string(obj.requestId)
          }

          if ((obj.success != null && obj.success !== false)) {
            w.uint32(16)
            w.bool(obj.success)
          }

          if (obj.data != null) {
            w.uint32(26)
            w.string(obj.data)
          }

          if (obj.error != null) {
            w.uint32(34)
            w.string(obj.error)
          }

          if ((obj.timestamp != null && obj.timestamp !== 0n)) {
            w.uint32(40)
            w.int64(obj.timestamp)
          }

          if (opts.lengthDelimited !== false) {
            w.ldelim()
          }
        }, (reader, length, opts = {}) => {
          const obj: any = {
            requestId: '',
            success: false,
            timestamp: 0n
          }

          const end = length == null ? reader.len : reader.pos + length

          while (reader.pos < end) {
            const tag = reader.uint32()

            switch (tag >>> 3) {
              case 1: {
                obj.requestId = reader.string()
                break
              }
              case 2: {
                obj.success = reader.bool()
                break
              }
              case 3: {
                obj.data = reader.string()
                break
              }
              case 4: {
                obj.error = reader.string()
                break
              }
              case 5: {
                obj.timestamp = reader.int64()
                break
              }
              default: {
                reader.skipType(tag & 7)
                break
              }
            }
          }

          return obj
        })
      }

      return _codec
    }

    export const encode = (obj: Partial<CommandResponse>): Uint8Array => {
      return encodeMessage(obj, CommandResponse.codec())
    }

    export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<CommandResponse>): CommandResponse => {
      return decodeMessage(buf, CommandResponse.codec(), opts)
    }
  }

  let _codec: Codec<ext>

  export const codec = (): Codec<ext> => {
    if (_codec == null) {
      _codec = message<ext>((obj, w, opts = {}) => {
        if (opts.lengthDelimited !== false) {
          w.fork()
        }

        if (opts.lengthDelimited !== false) {
          w.ldelim()
        }
      }, (reader, length, opts = {}) => {
        const obj: any = {}

        const end = length == null ? reader.len : reader.pos + length

        while (reader.pos < end) {
          const tag = reader.uint32()

          switch (tag >>> 3) {
            default: {
              reader.skipType(tag & 7)
              break
            }
          }
        }

        return obj
      })
    }

    return _codec
  }

  export const encode = (obj: Partial<ext>): Uint8Array => {
    return encodeMessage(obj, ext.codec())
  }

  export const decode = (buf: Uint8Array | Uint8ArrayList, opts?: DecodeOptions<ext>): ext => {
    return decodeMessage(buf, ext.codec(), opts)
  }
}
