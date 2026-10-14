# UCEP in this example

The spreadsheet serves itself to other libp2p applications over the **Universal Connectivity Extension Protocol**. The protocol is specified in [Le-Space/ucep-spec](https://github.com/Le-Space/ucep-spec) (Working Draft, wire revision 2) and implemented by the reference library [`@le-space/ucep`](https://github.com/Le-Space/ucep-js); this example uses that library on both sides — the sheet as a *provider*, and a *consumer* on the same node for the console and the tests. Nothing about the wire format lives in this repository any more.

In one paragraph: a provider registers `/uc/extension/{id}/{version}` as a libp2p protocol, so every peer learns it exists through identify — no registry, no server. A consumer asks for the manifest (always public), then calls commands by name with positional arguments (a 0.1 consumer such as the UC chat sends `/sheet-show <topic> <cell>`) or a JSON object (`{ topic, cell }`). Commands that change something carry a *scope*; a consumer pairs for it — by invitation (a link or QR code with a one-time secret) or in band (the same six-digit code on both screens) — and holds a *grant* the provider checks on every call.

## The extension `sheet`

Protocol `/uc/extension/sheet/1.1.0` · manifest in [`extension-manifest.json`](./extension-manifest.json) · code in [`sheet-extension.js`](./sheet-extension.js).

| command | syntax | scope | what it does |
| --- | --- | --- | --- |
| `help` | `/sheet-help` | public | the commands, and where the sheet lives |
| `show` | `/sheet-show <topic> <cell>` | public | the value, formula and error state of a cell |
| `write` | `/sheet-write <topic> <cell>=<value>` | public | write a value or a formula |
| `list` | `/sheet-list` | public | the sheets this peer has been on |
| `snapshot` | `/sheet-snapshot <topic>` | public | freeze the sheet: its state becomes a block, addressed by its CID |
| `snapshots` | `/sheet-snapshots <topic>` | public | the snapshots taken, newest first — CID, size, SHA-256, when, by whom |
| `restore` | `/sheet-restore <topic> <cid>` | `sheet:cells:write` | fetch a snapshot by CID — verified — and put the sheet back to it |

A peer serves the one sheet it is on; a command that names another topic is answered `UNAVAILABLE`. Bad arguments are `INVALID_ARGUMENTS`; `restore` without a grant is `PAIRING_REQUIRED`. `write` stays public so that a 0.1 consumer, which cannot pair, keeps working; the day the UC chat speaks revision 2, it moves behind the same scope.

## Snapshots: the sheet as content-addressed blocks

Yjs is the living document: every browser holds a copy, edits merge, there is only ever "now". A **snapshot** is the document's state as one block of bytes, and the block's hash as its address — a CID. The blocks live in a Helia node on top of the sheet's libp2p node ([`snapshots.js`](./snapshots.js)); a peer that does not hold a block fetches it over Bitswap, on the connection it already has, and Helia checks it against the CID before handing it out. The list of snapshots is part of the Yjs document, so it replicates with the sheet; the blocks do not — they travel on request.

A CRDT cannot be rewound, so `restore` does not apply the old update (that would change nothing); it reads the snapshot in a scratch document and writes its cells back as new edits, in one transaction, which every peer receives like any other change.

## Trying it

In the browser console of a sheet:

```js
await window.testExtension('<peerId of another sheet>', 'show', { topic: 'spreadsheet-1', cell: 'A1' })
await window.testExtension('<peerId>', 'snapshot', { topic: 'spreadsheet-1' })
window.listExtensions()        // the consumer's catalogue
window.sheet.snapshots.entries()
```

To restore on another peer's sheet, pair first: the provider hands out an invitation (`window.sheet.extension.provider.createInvitation({ scopes: ['sheet:cells:write'] })`), the consumer takes it (`window.sheet.consumer.pairWithInvitation(uri)`), then `restore` is allowed.

The end-to-end test [`test/snapshot.spec.js`](./test/snapshot.spec.js) runs exactly this between two browsers: write, snapshot, list over UCEP, fetch over Bitswap and verify, refused restore, pairing, restore — on the suite's own relay, with no public relay involved (`?relay=` and `?topic=` in the URL name both before the app connects).
