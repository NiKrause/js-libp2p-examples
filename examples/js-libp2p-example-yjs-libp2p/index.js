import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { autoNAT } from "@libp2p/autonat";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { dcutr } from "@libp2p/dcutr";
import { identify, identifyPush } from "@libp2p/identify";
import { pubsubPeerDiscovery } from "@libp2p/pubsub-peer-discovery";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { multiaddr } from "@multiformats/multiaddr";
import { createLibp2p } from "libp2p";
import * as Y from "yjs";
import { DEBUG, TIMEOUTS, INTERVALS, PUBSUB_DISCOVERY } from "./constants.js";
import { Libp2pProvider } from "./yjs-libp2p-provider.js";
import {
  SpreadsheetEngine,
  coordToA1,
  a1ToCoord,
} from "./spreadsheet-engine.js";

// UI elements
const relayInput = document.getElementById("relay");
const topicInput = document.getElementById("topic");
const connectBtn = document.getElementById("connect");
const logEl = document.getElementById("log");
const peersEl = document.getElementById("peers");
const peerCountEl = document.getElementById("peer-count");
const peerListEl = document.getElementById("peer-list");
const spreadsheetEl = document.getElementById("spreadsheet");
const formulaInput = document.getElementById("formula-input");
const cellRefEl = document.getElementById("cell-ref");
const formulaBar = document.getElementById("formula-bar");
const spreadsheetContainer = document.getElementById("spreadsheet-container");
const examplesEl = document.getElementById("examples");

let libp2pNode;
let yjsDoc;
let provider;
let spreadsheetEngine;
let currentCell = null;
let gridSize = { rows: 10, cols: 8 }; // Start with 10x8 grid

/**
 * Logs a message to both console and UI.
 *
 * @param {string} message - Message to log
 * @param {boolean} [isError] - Whether this is an error message
 */
const log = (message, isError = false) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(message);
  }
  logEl.textContent += message + "\n";
  logEl.scrollTop = logEl.scrollHeight;

  if (isError) {
    logEl.style.color = "#d32f2f";
  } else {
    logEl.style.color = "inherit";
  }
};

/**
 * Updates the peer display UI with current connections.
 */
const updatePeerDisplay = () => {
  if (!libp2pNode) {
    return;
  }

  const connections = libp2pNode.getConnections();
  const peerMap = new Map();

  // Group connections by peer
  for (const conn of connections) {
    const peerId = conn.remotePeer.toString();
    if (!peerMap.has(peerId)) {
      peerMap.set(peerId, []);
    }

    const remoteAddr = conn.remoteAddr.toString();
    let transport = "unknown";

    if (remoteAddr.includes("/p2p-circuit")) {
      transport = "relay";
    } else if (remoteAddr.includes("/webrtc")) {
      transport = "webrtc";
    } else if (remoteAddr.includes("/wss") || remoteAddr.includes("/tls/ws")) {
      transport = "websocket-secure";
    } else if (remoteAddr.includes("/ws")) {
      transport = "websocket";
    }

    peerMap.get(peerId).push({ transport, addr: remoteAddr });
  }

  // Update count
  peerCountEl.textContent = peerMap.size;

  // Show/hide peers section
  if (peerMap.size > 0) {
    peersEl.style.display = "block";
  } else {
    peersEl.style.display = "none";
  }

  // Update peer list
  peerListEl.innerHTML = "";
  for (const [peerId, transports] of peerMap) {
    const peerDiv = document.createElement("div");
    peerDiv.className = "peer";

    const peerIdSpan = document.createElement("div");
    peerIdSpan.className = "peer-id";
    peerIdSpan.textContent = peerId;
    peerDiv.appendChild(peerIdSpan);

    const transportDiv = document.createElement("div");

    // Show each connection with its transport
    for (const { transport, addr } of transports) {
      const badge = document.createElement("span");
      badge.className = "transport";
      badge.textContent = transport;
      badge.title = addr; // Show full address on hover
      transportDiv.appendChild(badge);
    }

    peerDiv.appendChild(transportDiv);

    peerListEl.appendChild(peerDiv);
  }
};

/**
 * Validates a multiaddr string format.
 *
 * @param {string} addr - Multiaddr to validate
 * @returns {boolean}
 */
const isValidMultiaddr = (addr) => {
  try {
    multiaddr(addr);
    return true;
  } catch {
    return false;
  }
};

// Connect button handler
connectBtn.onclick = async () => {
  if (libp2pNode) {
    log("Already connected");
    return;
  }

  const relayAddr = relayInput.value.trim();
  if (!relayAddr) {
    log("Please enter a relay multiaddr", true);
    return;
  }

  if (!isValidMultiaddr(relayAddr)) {
    log("Invalid multiaddr format", true);
    return;
  }

  const topic = topicInput.value.trim();
  if (!topic) {
    log("Please enter a topic", true);
    return;
  }

  try {
    connectBtn.disabled = true;
    log("Creating libp2p node...");

    // Create libp2p node with WebRTC, relay, and pubsub
    libp2pNode = await createLibp2p({
      addresses: {
        listen: ["/p2p-circuit", "/webrtc"],
      },
      transports: [
        webSockets({ filter: filters.all }),
        webRTC({
          rtcConfiguration: {
            iceServers: [
              { urls: ["stun:stun.l.google.com:19302"] },
              { urls: ["stun:stun1.l.google.com:19302"] },
            ],
          },
        }),
        circuitRelayTransport({
          reservationCompletionTimeout: TIMEOUTS.RELAY_CONNECTION,
        }),
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionManager: {
        inboundStreamProtocolNegotiationTimeout:
          TIMEOUTS.PROTOCOL_NEGOTIATION_INBOUND,
        inboundUpgradeTimeout: TIMEOUTS.UPGRADE_INBOUND,
        outboundStreamProtocolNegotiationTimeout:
          TIMEOUTS.PROTOCOL_NEGOTIATION_OUTBOUND,
        outboundUpgradeTimeout: TIMEOUTS.UPGRADE_OUTBOUND,
      },
      connectionGater: {
        denyDialMultiaddr: () => false,
      },
      peerDiscovery: [
        pubsubPeerDiscovery({
          interval: INTERVALS.PUBSUB_PEER_DISCOVERY,
          topics: PUBSUB_DISCOVERY.TOPICS,
          listenOnly: false,
        }),
      ],
      services: {
        identify: identify(),
        identifyPush: identifyPush(),
        autoNAT: autoNAT(),
        dcutr: dcutr(),
        pubsub: gossipsub({
          emitSelf: false,
          allowPublishToZeroTopicPeers: true,
          heartbeatInterval: INTERVALS.GOSSIPSUB_HEARTBEAT,
          directPeers: [],
          floodPublish: true,
        }),
      },
    });

    log(
      `libp2p node created with id: ${libp2pNode.peerId.toString().slice(0, 12)}...`,
    );

    // Expose for testing
    window.libp2pNode = libp2pNode;

    // Connect to relay
    log("Connecting to relay...");
    try {
      const ma = multiaddr(relayAddr);
      await libp2pNode.dial(ma);
      log("Connected to relay!");
    } catch (err) {
      throw new Error(`Failed to connect to relay: ${err.message}`);
    }

    // Create Yjs document and spreadsheet engine
    yjsDoc = new Y.Doc();
    spreadsheetEngine = new SpreadsheetEngine(yjsDoc);

    // Set up Yjs provider with libp2p
    log(`Setting up Yjs provider with topic: ${topic}`);
    provider = new Libp2pProvider(topic, yjsDoc, libp2pNode);

    // Create spreadsheet grid
    createSpreadsheetGrid();

    // Watch for cell changes
    spreadsheetEngine.onChange((coord) => {
      updateCellDisplay(coord);
    });

    // Show spreadsheet UI
    spreadsheetContainer.style.display = "block";
    formulaBar.style.display = "flex";
    examplesEl.style.display = "block";
    formulaInput.disabled = false;

    log(
      "Ready! Open this page in another browser tab or window to collaborate.",
    );

    // Initial peer display update
    updatePeerDisplay();

    // Update peer display on connection events
    libp2pNode.addEventListener("peer:connect", (evt) => {
      updatePeerDisplay();
      if (DEBUG) {
        log(`Connected to peer: ${evt.detail.toString().slice(0, 12)}...`);
      }
    });

    libp2pNode.addEventListener("peer:disconnect", (evt) => {
      updatePeerDisplay();
      if (DEBUG) {
        log(`Disconnected from peer: ${evt.detail.toString().slice(0, 12)}...`);
      }
    });
  } catch (err) {
    log(`Error: ${err.message}`, true);
    // eslint-disable-next-line no-console
    console.error("Connection error:", err);
    connectBtn.disabled = false;

    // Clean up on error
    if (libp2pNode) {
      try {
        await libp2pNode.stop();
      } catch (stopErr) {
        // eslint-disable-next-line no-console
        console.error("Error stopping libp2p:", stopErr);
      }
      libp2pNode = null;
    }
  }
};

/**
 * Create the spreadsheet grid UI
 */
function createSpreadsheetGrid() {
  // Create header row with column letters
  const headerRow = document.createElement("tr");
  headerRow.appendChild(document.createElement("th")); // Corner cell

  for (let col = 0; col < gridSize.cols; col++) {
    const th = document.createElement("th");
    th.textContent = colToLetter(col);
    headerRow.appendChild(th);
  }
  spreadsheetEl.appendChild(headerRow);

  // Create data rows
  for (let row = 0; row < gridSize.rows; row++) {
    const tr = document.createElement("tr");

    // Row header
    const rowHeader = document.createElement("th");
    rowHeader.textContent = row + 1;
    tr.appendChild(rowHeader);

    // Data cells
    for (let col = 0; col < gridSize.cols; col++) {
      const td = document.createElement("td");
      const input = document.createElement("input");
      const coord = coordToA1(row, col);

      input.id = `cell-${coord}`;
      input.dataset.coord = coord;
      input.type = "text";

      // Focus handler - select cell
      input.addEventListener("focus", () => {
        selectCell(coord);
      });

      // Input handler - update cell value
      input.addEventListener("blur", () => {
        const value = input.value.trim();
        if (value === "") {
          spreadsheetEngine.clearCell(coord);
        } else {
          spreadsheetEngine.setCell(coord, value);
        }
      });

      // Enter key - move to next row
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const value = input.value.trim();
          if (value === "") {
            spreadsheetEngine.clearCell(coord);
          } else {
            spreadsheetEngine.setCell(coord, value);
          }

          // Move to cell below
          const { row: r, col: c } = a1ToCoord(coord);
          if (r < gridSize.rows - 1) {
            const nextCoord = coordToA1(r + 1, c);
            document.getElementById(`cell-${nextCoord}`).focus();
          }
        }
      });

      td.appendChild(input);
      tr.appendChild(td);
    }

    spreadsheetEl.appendChild(tr);
  }

  // Select first cell by default
  selectCell("A1");
}

/**
 * Convert column index to letter
 */
function colToLetter(col) {
  let letter = "";
  while (col >= 0) {
    letter = String.fromCharCode(65 + (col % 26)) + letter;
    col = Math.floor(col / 26) - 1;
  }
  return letter;
}

/**
 * Select a cell and update formula bar
 */
function selectCell(coord) {
  // Remove previous selection
  if (currentCell) {
    const prevTd = document.getElementById(
      `cell-${currentCell}`,
    )?.parentElement;
    if (prevTd) prevTd.classList.remove("selected");
  }

  currentCell = coord;

  // Add selection to new cell
  const td = document.getElementById(`cell-${coord}`)?.parentElement;
  if (td) td.classList.add("selected");

  // Update formula bar
  cellRefEl.textContent = coord + ":";
  const cell = spreadsheetEngine.getCell(coord);
  formulaInput.value = cell.formula || cell.value;
}

/**
 * Update cell display when value changes
 */
function updateCellDisplay(coord) {
  const input = document.getElementById(`cell-${coord}`);
  if (!input) return;

  const cell = spreadsheetEngine.getCell(coord);
  const td = input.parentElement;

  // Only update if not currently focused
  if (document.activeElement !== input) {
    input.value = cell.value;
  }

  // Update error styling
  if (
    cell.error ||
    (typeof cell.value === "string" && cell.value.startsWith("#"))
  ) {
    td.classList.add("error");
  } else {
    td.classList.remove("error");
  }

  // Update formula bar if this is the selected cell
  if (currentCell === coord) {
    formulaInput.value = cell.formula || cell.value;
  }
}

// Formula bar input handler
if (formulaInput) {
  formulaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && currentCell) {
      e.preventDefault();
      const value = formulaInput.value.trim();
      const input = document.getElementById(`cell-${currentCell}`);

      if (value === "") {
        spreadsheetEngine.clearCell(currentCell);
        if (input) input.value = "";
      } else {
        spreadsheetEngine.setCell(currentCell, value);
      }

      // Refocus the cell
      if (input) input.focus();
    }
  });
}

/**
 * Cleanup resources on page unload.
 */
window.addEventListener("beforeunload", async () => {
  try {
    if (provider) {
      await provider.destroy();
    }
    if (libp2pNode) {
      await libp2pNode.stop();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Cleanup error:", err);
  }
});
