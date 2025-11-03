/**
 * Determines transport type from a remote address.
 *
 * @param {string} remoteAddr - The remote address string
 * @returns {string} Transport type identifier
 */
export function getTransportType (remoteAddr) {
  if (remoteAddr.includes('/p2p-circuit')) {
    // Check if this is a WebRTC connection over relay
    if (remoteAddr.includes('/p2p-circuit/webrtc')) {
      return 'relay-webrtc'
    }
    return 'relay'
  }
  if (remoteAddr.includes('/webrtc')) {
    // Direct WebRTC connection (not relayed)
    return 'webrtc'
  }
  if (remoteAddr.includes('/wss') || remoteAddr.includes('/tls/ws')) {
    return 'websocket-secure'
  }
  if (remoteAddr.includes('/ws')) {
    return 'websocket'
  }
  return 'unknown'
}

/**
 * Creates transport badges for a peer's connections.
 *
 * @param {Array} transports - Array of connection objects
 * @returns {HTMLElement} Container with transport badges
 */
export function createTransportBadges (transports) {
  const transportDiv = document.createElement('div')

  // Group identical transport+direction combinations and count them
  const transportGroups = new Map()
  for (const conn of transports) {
    const key = `${conn.transport}-${conn.direction}`
    if (!transportGroups.has(key)) {
      transportGroups.set(key, [])
    }
    transportGroups.get(key).push(conn)
  }

  // Show each unique transport+direction with count
  for (const conns of transportGroups.values()) {
    const { transport, direction } = conns[0]
    const badge = document.createElement('span')
    badge.className = `transport ${transport}`

    // Add direction indicator to badge text
    let directionIcon = '•'
    if (direction === 'inbound') {
      directionIcon = '←'
    } else if (direction === 'outbound') {
      directionIcon = '→'
    }
    const countText = conns.length > 1 ? ` ×${conns.length}` : ''
    badge.textContent = `${transport} ${directionIcon}${countText}`

    // Enhanced tooltip with connection details for all connections in this group
    const tooltipLines = [`${transport} (${direction}) - ${conns.length} connection(s)`, '']
    conns.forEach((conn, idx) => {
      tooltipLines.push(`Connection ${idx + 1}:`)
      tooltipLines.push(`  Address: ${conn.addr}`)
      tooltipLines.push(`  Status: ${conn.status}`)
      tooltipLines.push(`  ID: ${conn.connId}`)
      tooltipLines.push('')
    })
    badge.title = tooltipLines.join('\n')

    transportDiv.appendChild(badge)
  }

  return transportDiv
}

/**
 * Updates the peer display UI with current connections.
 *
 * @param {object} libp2pNode - The libp2p node instance
 * @param {HTMLElement} peerCountEl - Element to display peer count
 * @param {HTMLElement} peersEl - Element to show/hide peers section
 * @param {HTMLElement} peerListEl - Element to display peer list
 */
export function updatePeerDisplay (libp2pNode, peerCountEl, peersEl, peerListEl) {
  if (!libp2pNode) {
    return
  }

  const connections = libp2pNode.getConnections()
  const peerMap = new Map()

  // Group connections by peer
  for (const conn of connections) {
    const peerId = conn.remotePeer.toString()
    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, [])
    }

    const remoteAddr = conn.remoteAddr.toString()
    const transport = getTransportType(remoteAddr)

    // Gather connection metadata for tooltip
    const direction = conn.direction || 'unknown'
    const status = conn.status || 'unknown'
    const timeline = conn.timeline || {}
    const connId = conn.id || 'unknown'

    peerMap.get(peerId).push({
      transport,
      addr: remoteAddr,
      direction,
      status,
      connId,
      timeline
    })
  }

  // Update count
  peerCountEl.textContent = peerMap.size

  // Show/hide peers section
  if (peerMap.size > 0) {
    peersEl.style.display = 'block'
  } else {
    peersEl.style.display = 'none'
  }

  // Update peer list
  peerListEl.innerHTML = ''
  for (const [peerId, transports] of peerMap) {
    const peerDiv = document.createElement('div')
    peerDiv.className = 'peer'

    const peerIdSpan = document.createElement('div')
    peerIdSpan.className = 'peer-id'
    peerIdSpan.textContent = `${peerId.slice(0, 8)}...${peerId.slice(-4)}`
    peerIdSpan.title = peerId // Full peer ID on hover
    peerDiv.appendChild(peerIdSpan)

    const transportDiv = createTransportBadges(transports)
    peerDiv.appendChild(transportDiv)

    peerListEl.appendChild(peerDiv)
  }
}

/**
 * Updates the multiaddress display with current addresses.
 *
 * @param {object} libp2pNode - The libp2p node instance
 * @param {HTMLElement} multiaddrsEl - Element to show/hide multiaddrs section
 * @param {HTMLElement} multiaddrSelectEl - Select element to display addresses
 */
export function updateMultiaddrDisplay (libp2pNode, multiaddrsEl, multiaddrSelectEl) {
  if (!libp2pNode) {
    return
  }

  const multiaddrs = libp2pNode.getMultiaddrs()

  // Always show the section, even if empty
  multiaddrsEl.style.display = 'block'

  if (multiaddrs.length > 0) {
    multiaddrSelectEl.innerHTML = ''
    for (const ma of multiaddrs) {
      const option = document.createElement('option')
      const maStr = ma.toString()

      // Add label for relay addresses
      if (maStr.includes('/p2p-circuit')) {
        option.textContent = `${maStr} (relay)`
      } else if (maStr.includes('/webrtc')) {
        option.textContent = `${maStr} (WebRTC)`
      } else if (maStr.includes('/ws')) {
        option.textContent = `${maStr} (WebSocket)`
      } else {
        option.textContent = maStr
      }

      multiaddrSelectEl.appendChild(option)
    }
  } else {
    // Show message when no addresses yet
    multiaddrSelectEl.innerHTML = '<option disabled>Waiting for addresses (relay reservation in progress...)</option>'
  }
}
