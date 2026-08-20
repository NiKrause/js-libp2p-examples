import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths so the build also loads from a path-style IPFS
  // gateway (https://ipfs.aleph.im/ipfs/<cid>/), where an absolute /assets/…
  // would be fetched from the gateway root instead of the CID.
  base: './',
  server: {
    open: true
  }
})
