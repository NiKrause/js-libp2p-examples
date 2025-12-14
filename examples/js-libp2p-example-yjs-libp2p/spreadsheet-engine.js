import * as Y from 'yjs'

/**
 * SpreadsheetEngine - Manages a collaborative spreadsheet using Yjs
 *
 * Features:
 * - 2D grid with A1-style cell addressing
 * - Basic formulas with cell references
 * - Automatic recalculation on dependency changes
 * - Circular reference detection
 */

/**
 * Converts column number to letter(s) (0 -> A, 25 -> Z, 26 -> AA)
 *
 * @param col
 */
function colToLetter (col) {
  let letter = ''
  while (col >= 0) {
    letter = String.fromCharCode(65 + (col % 26)) + letter
    col = Math.floor(col / 26) - 1
  }
  return letter
}

/**
 * Converts letter(s) to column number (A -> 0, Z -> 25, AA -> 26)
 *
 * @param letter
 */
function letterToCol (letter) {
  let col = 0
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + letter.charCodeAt(i) - 64
  }
  return col - 1
}

/**
 * Converts row/col indices to A1 notation
 *
 * @param row
 * @param col
 */
export function coordToA1 (row, col) {
  return colToLetter(col) + (row + 1)
}

/**
 * Converts A1 notation to {row, col} indices
 * Case-insensitive: accepts both 'A1' and 'a1'
 *
 * @param a1
 */
export function a1ToCoord (a1) {
  const match = a1.toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if (!match) { return null }
  return {
    col: letterToCol(match[1]),
    row: parseInt(match[2]) - 1
  }
}

/**
 * Parse cell references from a formula
 * Returns array of cell coordinates (e.g., ['A1', 'B2'])
 *
 * @param formula
 */
function parseCellRefs (formula) {
  const refs = []
  const regex = /\b([A-Z]+\d+)\b/g
  let match
  while ((match = regex.exec(formula)) !== null) {
    refs.push(match[1])
  }
  return refs
}

/**
 * Parse range references like A1:A10
 * Returns array of all cells in range
 *
 * @param range
 */
function parseRange (range) {
  const match = range.match(/^([A-Z]+\d+):([A-Z]+\d+)$/)
  if (!match) { return [range] }

  const start = a1ToCoord(match[1])
  const end = a1ToCoord(match[2])
  if (!start || !end) { return [range] }

  const cells = []
  for (let row = start.row; row <= end.row; row++) {
    for (let col = start.col; col <= end.col; col++) {
      cells.push(coordToA1(row, col))
    }
  }
  return cells
}

export class SpreadsheetEngine {
  constructor (yjsDoc) {
    this.yjsDoc = yjsDoc
    this.cells = yjsDoc.getMap('cells')
    this.dependencyGraph = new Map() // cellId -> Set of dependent cellIds
    this.observers = new Set()
    this.isProcessing = false // Guard against recursive processing

    // Set up Yjs UndoManager for undo/redo functionality
    this.undoManager = new Y.UndoManager(this.cells, {
      trackedOrigins: new Set([null, 'user-action']),
      captureTimeout: 500 // Group rapid changes within 500ms as one undo step
    })

    // Watch for changes to recalculate
    this.cells.observeDeep((events) => {
      this.handleDeepCellChanges(events)
    })

    // Rebuild dependency graph for all existing formulas
    // (important when loading existing document or joining session)
    this.rebuildAllDependencies()
  }

  /**
   * Set a cell value or formula
   *
   * @param coord
   * @param value
   */
  setCell (coord, value) {
    // Normalize coordinate to uppercase
    const normalizedCoord = coord.toUpperCase()

    // Get or create a Yjs Map for this cell
    let cellData = this.cells.get(normalizedCoord)
    if (!cellData) {
      cellData = new Y.Map()
      this.cells.set(normalizedCoord, cellData)
    }

    if (typeof value === 'string' && value.startsWith('=')) {
      // It's a formula - normalize to uppercase for consistent cell references
      const formula = value.toUpperCase()
      const refs = this.extractReferences(formula)

      // Clear old dependencies (this cell's dependencies, not cells depending on this cell)
      this.removeDependencies(normalizedCoord)

      // Build dependency graph
      for (const ref of refs) {
        if (!this.dependencyGraph.has(ref)) {
          this.dependencyGraph.set(ref, new Set())
        }
        this.dependencyGraph.get(ref).add(normalizedCoord)
      }

      // Check for circular references
      if (this.hasCircularReference(normalizedCoord)) {
        cellData.set('value', '#CIRCULAR!')
        cellData.set('formula', formula)
        cellData.set('error', true)
      } else {
        // Evaluate the formula
        const result = this.evaluate(formula, normalizedCoord)
        cellData.set('value', result)
        cellData.set('formula', formula)
        cellData.set('error', false)
      }
    } else {
      // Raw value - only clear dependencies if this cell previously had a formula
      const hadFormula = cellData.get('formula') != null
      if (hadFormula) {
        this.removeDependencies(normalizedCoord)
      }

      cellData.set('value', value)
      cellData.set('formula', null)
      cellData.set('error', false)
    }
  }

  /**
   * Get cell data
   * Case-insensitive: accepts both 'A1' and 'a1'
   *
   * @param coord
   */
  getCell (coord) {
    const cellData = this.cells.get(coord.toUpperCase())
    if (!cellData) { return { value: '', formula: null, error: false } }

    return {
      value: cellData.get('value') || '',
      formula: cellData.get('formula') || null,
      error: cellData.get('error') || false
    }
  }

  /**
   * Extract all cell references from formula (including ranges)
   *
   * @param formula
   */
  extractReferences (formula) {
    const refs = new Set()

    // Find SUM(A1:A10) style ranges
    const rangeRegex = /\b([A-Z]+\d+:[A-Z]+\d+)\b/g
    let match
    while ((match = rangeRegex.exec(formula)) !== null) {
      const cells = parseRange(match[1])
      cells.forEach((cell) => refs.add(cell))
    }

    // Find individual cell references
    const cellRefs = parseCellRefs(formula)
    cellRefs.forEach((ref) => refs.add(ref))

    return Array.from(refs)
  }

  /**
   * Evaluate a formula
   *
   * @param formula
   * @param currentCell
   */
  evaluate (formula, currentCell) {
    try {
      // Remove leading =
      let expr = formula.substring(1).trim()

      // Handle SUM function
      expr = expr.replace(/SUM\(([A-Z]+\d+:[A-Z]+\d+)\)/gi, (match, range) => {
        const cells = parseRange(range)
        const values = cells.map((coord) => {
          const cell = this.getCell(coord)
          const num = parseFloat(cell.value)
          return isNaN(num) ? 0 : num
        })
        return values.reduce((sum, val) => sum + val, 0)
      })

      // Replace cell references with their values
      expr = expr.replace(/\b([A-Z]+\d+)\b/g, (match) => {
        if (match === currentCell) { return '0' } // Prevent self-reference
        const cell = this.getCell(match)
        const num = parseFloat(cell.value)
        return isNaN(num) ? '0' : num.toString()
      })

      // Evaluate the expression safely
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${expr})`)()

      if (typeof result === 'number' && isFinite(result)) {
        return result
      }
      return '#ERROR!'
    } catch {
      return '#ERROR!'
    }
  }

  /**
   * Check for circular references using DFS
   *
   * @param coord
   * @param visited
   * @param path
   */
  hasCircularReference (coord, visited = new Set(), path = new Set()) {
    if (path.has(coord)) { return true }
    if (visited.has(coord)) { return false }

    visited.add(coord)
    path.add(coord)

    const dependents = this.dependencyGraph.get(coord)
    if (dependents) {
      for (const dependent of dependents) {
        if (this.hasCircularReference(dependent, visited, path)) {
          return true
        }
      }
    }

    path.delete(coord)
    return false
  }

  /**
   * Remove cell from dependency graph
   *
   * @param coord
   */
  removeDependencies (coord) {
    // Remove this cell from all dependency lists
    for (const [, dependents] of this.dependencyGraph.entries()) {
      dependents.delete(coord)
    }
  }

  /**
   * Handle deep Yjs cell changes (including nested Y.Map changes)
   *
   * @param events
   */
  handleDeepCellChanges (events) {
    // Guard against recursive processing
    if (this.isProcessing) {
      return
    }

    const changedCells = new Set()

    for (const event of events) {
      if (event.target === this.cells) {
        // Changes to the cells map itself (adding/removing cells)
        event.changes.keys.forEach((change, key) => {
          changedCells.add(key)
        })
      } else {
        // Changes to a nested Y.Map (cell data)
        // Find which cell this Y.Map belongs to
        for (const [coord, cellData] of this.cells.entries()) {
          if (cellData === event.target) {
            changedCells.add(coord)
            break
          }
        }
      }
    }

    // Rebuild dependency graph for any cells with formulas
    // This ensures formulas synced from other peers can recalculate correctly
    changedCells.forEach((coord) => {
      const cellData = this.cells.get(coord)
      if (cellData && cellData.get('formula')) {
        this.rebuildDependenciesForCell(coord)
      }
    })

    this.processChangedCells(Array.from(changedCells))
  }

  /**
   * Rebuild dependency graph for a cell with a formula
   * Used when receiving formula updates from other peers
   *
   * @param coord
   */
  rebuildDependenciesForCell (coord) {
    const cellData = this.cells.get(coord)
    if (!cellData) { return }

    const formula = cellData.get('formula')
    if (!formula) { return }

    // Clear old dependencies for this cell
    this.removeDependencies(coord)

    // Rebuild dependencies
    const refs = this.extractReferences(formula)
    for (const ref of refs) {
      if (!this.dependencyGraph.has(ref)) {
        this.dependencyGraph.set(ref, new Set())
      }
      this.dependencyGraph.get(ref).add(coord)
    }
  }

  /**
   * Rebuild dependency graph for all cells with formulas
   * Called at initialization to build graph from existing document
   */
  rebuildAllDependencies () {
    // Clear existing graph
    this.dependencyGraph.clear()

    // Scan all cells and rebuild dependencies for formulas
    for (const [coord, cellData] of this.cells.entries()) {
      const formula = cellData.get('formula')
      if (formula) {
        const refs = this.extractReferences(formula)
        for (const ref of refs) {
          if (!this.dependencyGraph.has(ref)) {
            this.dependencyGraph.set(ref, new Set())
          }
          this.dependencyGraph.get(ref).add(coord)
        }
      }
    }
  }

  /**
   * Process changed cells and trigger recalculation
   *
   * @param changedCells
   */
  processChangedCells (changedCells) {
    // Find all cells that depend on changed cells
    const toRecalculate = new Set()
    const queue = [...changedCells]
    const visited = new Set()

    // First, add any changed cells that have formulas to toRecalculate
    // (they need to recalculate themselves, not just cells that depend on them)
    changedCells.forEach((coord) => {
      const cellData = this.cells.get(coord)
      if (cellData && cellData.get('formula')) {
        toRecalculate.add(coord)
      }
    })

    while (queue.length > 0) {
      const coord = queue.shift()
      if (visited.has(coord)) { continue }
      visited.add(coord)

      const dependents = this.dependencyGraph.get(coord)
      if (dependents) {
        dependents.forEach((dep) => {
          toRecalculate.add(dep)
          queue.push(dep)
        })
      }
    }

    // Set processing flag to prevent recursive observer calls
    this.isProcessing = true

    try {
      // Recalculate affected cells
      for (const coord of toRecalculate) {
        const cellData = this.cells.get(coord)
        if (cellData && cellData.get('formula')) {
          const formula = cellData.get('formula')
          const result = this.evaluate(formula, coord)

          // Only update if value actually changed (avoid unnecessary Yjs events)
          const currentValue = cellData.get('value')
          if (currentValue !== result) {
            cellData.set('value', result)
          }
        }
      }
    } finally {
      // Always clear the flag, even if there's an error
      this.isProcessing = false
    }

    // Notify observers of all changes (including formula cells that were synced)
    // Even if the value didn't change during recalculation, the UI needs to update
    changedCells.forEach((coord) => this.notifyObservers(coord))
    toRecalculate.forEach((coord) => this.notifyObservers(coord))
  }

  /**
   * Register an observer for cell changes
   *
   * @param callback
   */
  onChange (callback) {
    this.observers.add(callback)
    return () => this.observers.delete(callback)
  }

  /**
   * Notify all observers of a change
   *
   * @param coord
   */
  notifyObservers (coord) {
    this.observers.forEach((callback) => callback(coord))
  }

  /**
   * Get all cells in the spreadsheet
   */
  getAllCells () {
    const cells = new Map()
    for (const [coord, cellData] of this.cells.entries()) {
      cells.set(coord, {
        value: cellData.get('value') || '',
        formula: cellData.get('formula') || null,
        error: cellData.get('error') || false
      })
    }
    return cells
  }

  /**
   * Clear a cell
   * Case-insensitive: accepts both 'A1' and 'a1'
   *
   * @param coord
   */
  clearCell (coord) {
    const normalizedCoord = coord.toUpperCase()
    this.removeDependencies(normalizedCoord)
    this.cells.delete(normalizedCoord)
    this.notifyObservers(normalizedCoord)
  }

  /**
   * Undo the last change
   *
   * @returns {boolean} True if undo was performed, false if nothing to undo
   */
  undo () {
    if (this.undoManager.canUndo()) {
      this.undoManager.undo()
      return true
    }
    return false
  }

  /**
   * Redo the last undone change
   *
   * @returns {boolean} True if redo was performed, false if nothing to redo
   */
  redo () {
    if (this.undoManager.canRedo()) {
      this.undoManager.redo()
      return true
    }
    return false
  }

  /**
   * Check if undo is available
   *
   * @returns {boolean}
   */
  canUndo () {
    return this.undoManager.canUndo()
  }

  /**
   * Check if redo is available
   *
   * @returns {boolean}
   */
  canRedo () {
    return this.undoManager.canRedo()
  }

  /**
   * Clear undo/redo history
   */
  clearUndoHistory () {
    this.undoManager.clear()
  }
}

/**
 * SpreadsheetUI - Manages the spreadsheet user interface
 *
 * Handles:
 * - Grid creation and rendering
 * - Cell selection and navigation
 * - Formula bar updates
 * - Display updates when cells change
 */
export class SpreadsheetUI {
  constructor (spreadsheetEngine, options = {}) {
    this.engine = spreadsheetEngine
    this.currentCell = null
    this.gridSize = options.gridSize || { rows: 10, cols: 8 }

    // Selection tracking for copy/paste
    this.selectionStart = null
    this.selectionEnd = null
    this.copiedData = null // Stores copied cell data

    // DOM element references
    this.elements = {
      spreadsheet: options.spreadsheetEl || document.getElementById('spreadsheet'),
      formulaInput: options.formulaInput || document.getElementById('formula-input'),
      cellRef: options.cellRefEl || document.getElementById('cell-ref'),
      formulaBar: options.formulaBar || document.getElementById('formula-bar'),
      spreadsheetContainer: options.spreadsheetContainer || document.getElementById('spreadsheet-container'),
      examples: options.examplesEl || document.getElementById('examples')
    }

    // Watch for cell changes from the engine
    this.engine.onChange((coord) => this.updateCellDisplay(coord))
  }

  /**
   * Initialize the spreadsheet UI
   */
  initialize () {
    this.createGrid()
    this.setupFormulaBarHandler()
    this.setupClipboardHandlers()
    this.show()
    this.selectCell('A1')
  }

  /**
   * Show the spreadsheet UI
   */
  show () {
    if (this.elements.spreadsheetContainer) {
      this.elements.spreadsheetContainer.style.display = 'block'
    }
    if (this.elements.formulaBar) {
      this.elements.formulaBar.style.display = 'flex'
    }
    if (this.elements.examples) {
      this.elements.examples.style.display = 'block'
    }
    if (this.elements.formulaInput) {
      this.elements.formulaInput.disabled = false
    }
    // CSV controls are now in the toolbar and always visible
    // Set up CSV controls if not already done
    if (typeof window.setupCSVControls === 'function') {
      window.setupCSVControls()
      window.setupCSVControls = null // Prevent multiple setups
    }
  }

  /**
   * Create the spreadsheet grid UI
   */
  createGrid () {
    if (!this.elements.spreadsheet) { return }

    // Clear existing grid
    this.elements.spreadsheet.innerHTML = ''

    // Create header row with column letters
    const headerRow = document.createElement('tr')
    headerRow.appendChild(document.createElement('th')) // Corner cell

    for (let col = 0; col < this.gridSize.cols; col++) {
      const th = document.createElement('th')
      th.textContent = colToLetter(col)
      headerRow.appendChild(th)
    }
    this.elements.spreadsheet.appendChild(headerRow)

    // Create data rows
    for (let row = 0; row < this.gridSize.rows; row++) {
      const tr = document.createElement('tr')

      // Row header
      const rowHeader = document.createElement('th')
      rowHeader.textContent = row + 1
      tr.appendChild(rowHeader)

      // Data cells
      for (let col = 0; col < this.gridSize.cols; col++) {
        const td = document.createElement('td')
        const input = document.createElement('input')
        const coord = coordToA1(row, col)

        td.dataset.cell = coord
        input.id = `cell-${coord}`
        input.type = 'text'

        // Track the original value when focused to detect actual changes
        let originalValue = ''

        // Focus handler - select cell and show formula if exists
        input.addEventListener('focus', () => {
          this.selectCell(coord)

          // Show formula in the input when focused (like Excel)
          const cell = this.engine.getCell(coord)
          if (cell.formula) {
            input.value = cell.formula
            originalValue = cell.formula.trim()
          } else {
            originalValue = (cell.value || '').toString().trim()
          }
        })

        // Blur handler - only update if value actually changed
        input.addEventListener('blur', () => {
          const value = input.value.trim()

          // Only update if the value actually changed
          if (value !== originalValue) {
            if (value === '') {
              this.engine.clearCell(coord)
            } else {
              this.engine.setCell(coord, value)
            }
          } else {
            // No change - restore the display value (result for formulas)
            const cell = this.engine.getCell(coord)
            input.value = cell.value || ''
          }
        })

        // Keyboard navigation
        input.addEventListener('keydown', (e) => {
          this.handleCellKeydown(e, coord, input)
        })

        td.appendChild(input)
        tr.appendChild(td)
      }

      this.elements.spreadsheet.appendChild(tr)
    }

    // Populate grid with any existing data from Yjs document
    // This is crucial for late joiners who receive data after UI initialization
    for (let row = 0; row < this.gridSize.rows; row++) {
      for (let col = 0; col < this.gridSize.cols; col++) {
        const coord = coordToA1(row, col)
        this.updateCellDisplay(coord)
      }
    }
  }

  /**
   * Navigate to a cell if the coordinate is valid
   *
   * @param nextCoord - Target cell coordinate
   */
  navigateToCell (nextCoord) {
    if (nextCoord) {
      const nextInput = document.getElementById(`cell-${nextCoord}`)
      if (nextInput) {
        nextInput.focus()
      }
    }
  }

  /**
   * Handle Enter key in cell
   *
   * @param r - Row index
   * @param c - Column index
   * @returns Target coordinate or null
   */
  handleEnterKey (r, c) {
    // Move to cell below (or stay if at bottom)
    if (r < this.gridSize.rows - 1) {
      return coordToA1(r + 1, c)
    }
    return null
  }

  /**
   * Handle Tab key in cell
   *
   * @param e - Keyboard event
   * @param r - Row index
   * @param c - Column index
   * @returns Target coordinate or null
   */
  handleTabKey (e, r, c) {
    // Tab moves right, Shift+Tab moves left
    if (e.shiftKey) {
      if (c > 0) {
        return coordToA1(r, c - 1)
      }
    } else {
      if (c < this.gridSize.cols - 1) {
        return coordToA1(r, c + 1)
      }
    }
    return null
  }

  /**
   * Handle arrow keys in cell
   *
   * @param e - Keyboard event
   * @param r - Row index
   * @param c - Column index
   * @param input - Input element
   * @returns Object with nextCoord and shouldNavigate
   */
  handleArrowKey (e, r, c, input) {
    if (e.key === 'ArrowUp') {
      if (r > 0) {
        return { nextCoord: coordToA1(r - 1, c), shouldNavigate: true }
      }
    } else if (e.key === 'ArrowDown') {
      if (r < this.gridSize.rows - 1) {
        return { nextCoord: coordToA1(r + 1, c), shouldNavigate: true }
      }
    } else if (e.key === 'ArrowLeft') {
      // Navigate left only if cursor is at the start of the text
      const cursorPos = input.selectionStart
      if (cursorPos === 0 && c > 0) {
        return { nextCoord: coordToA1(r, c - 1), shouldNavigate: true }
      }
    } else if (e.key === 'ArrowRight') {
      // Navigate right only if cursor is at the end of the text
      const cursorPos = input.selectionStart
      const textLength = input.value.length
      if (cursorPos === textLength && c < this.gridSize.cols - 1) {
        return { nextCoord: coordToA1(r, c + 1), shouldNavigate: true }
      }
    }
    return { nextCoord: null, shouldNavigate: false }
  }

  /**
   * Handle keyboard navigation in cells
   *
   * @param e - Keyboard event
   * @param coord - Current cell coordinate
   * @param input - Input element
   */
  handleCellKeydown (e, coord, input) {
    const { row: r, col: c } = a1ToCoord(coord)
    let nextCoord = null
    let shouldNavigate = false

    // Handle navigation keys
    if (e.key === 'Enter') {
      e.preventDefault()
      nextCoord = this.handleEnterKey(r, c)
      shouldNavigate = true
    } else if (e.key === 'Tab') {
      e.preventDefault()
      nextCoord = this.handleTabKey(e, r, c)
      shouldNavigate = true
    } else if (e.key === 'Escape') {
      // Escape key - revert changes and unfocus (show result, not formula)
      e.preventDefault()
      const cell = this.engine.getCell(coord)
      input.value = cell.value || ''
      input.blur()
      return
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const result = this.handleArrowKey(e, r, c, input)
      nextCoord = result.nextCoord
      shouldNavigate = result.shouldNavigate
    }

    // Move to next cell if determined
    if (shouldNavigate) {
      this.navigateToCell(nextCoord)
    }
  }

  /**
   * Select a cell and update formula bar
   *
   * @param coord - Cell coordinate (e.g., 'A1')
   */
  selectCell (coord) {
    // Remove previous selection
    if (this.currentCell) {
      const prevInput = document.getElementById(`cell-${this.currentCell}`)
      const prevTd = prevInput?.parentElement
      if (prevTd) {
        prevTd.classList.remove('selected')
      }
    }

    this.currentCell = coord

    // Add selection to new cell
    const input = document.getElementById(`cell-${coord}`)
    const td = input?.parentElement
    if (td) {
      td.classList.add('selected')
    }

    // Update formula bar - show formula if available, otherwise the value
    if (this.elements.cellRef) {
      this.elements.cellRef.textContent = coord + ':'
    }

    if (this.elements.formulaInput) {
      const cell = this.engine.getCell(coord)
      // Always prioritize formula over value for display in formula bar
      if (cell.formula) {
        this.elements.formulaInput.value = cell.formula
      } else {
        this.elements.formulaInput.value = cell.value || ''
      }
    }
  }

  /**
   * Update cell display when value changes
   *
   * @param coord - Cell coordinate
   */
  updateCellDisplay (coord) {
    const input = document.getElementById(`cell-${coord}`)
    if (!input) { return }

    const cell = this.engine.getCell(coord)
    const td = input.parentElement

    // Only update if not currently focused
    if (document.activeElement !== input) {
      input.value = cell.value
    }

    // Update error styling
    if (
      cell.error ||
      (typeof cell.value === 'string' && cell.value.startsWith('#'))
    ) {
      td.classList.add('error')
    } else {
      td.classList.remove('error')
    }

    // Update formula bar if this is the selected cell
    if (this.currentCell === coord && this.elements.formulaInput) {
      if (cell.formula) {
        this.elements.formulaInput.value = cell.formula
      } else {
        this.elements.formulaInput.value = cell.value || ''
      }
    }
  }

  /**
   * Set up formula bar event handlers
   */
  setupFormulaBarHandler () {
    if (!this.elements.formulaInput) { return }

    this.elements.formulaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.currentCell) {
        e.preventDefault()
        const value = this.elements.formulaInput.value.trim()
        const input = document.getElementById(`cell-${this.currentCell}`)

        if (value === '') {
          this.engine.clearCell(this.currentCell)
          if (input) {
            input.value = ''
          }
        } else {
          this.engine.setCell(this.currentCell, value)
        }

        // Refocus the cell
        if (input) {
          input.focus()
        }
      }
    })
  }

  /**
   * Get the currently selected cell
   */
  getCurrentCell () {
    return this.currentCell
  }

  /**
   * Get the grid size
   */
  getGridSize () {
    return this.gridSize
  }

  /**
   * Check if the active element is a spreadsheet focus target
   */
  isSpreadsheetFocus () {
    const activeEl = document.activeElement
    return activeEl?.id?.startsWith('cell-') || activeEl?.id === 'formula-input'
  }

  /**
   * Handle keyboard shortcuts for undo/redo/copy/cut/paste
   *
   * @param e
   */
  handleKeyboardShortcut (e) {
    if (!this.isSpreadsheetFocus()) { return }

    const isModifier = e.ctrlKey || e.metaKey

    const key = e.key.toLowerCase()

    // Undo: Ctrl+Z or Cmd+Z (but not Shift+Z)
    if (isModifier && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      this.handleUndo()
      return
    }

    // Redo: Ctrl+Y or Cmd+Y or Ctrl+Shift+Z or Cmd+Shift+Z
    if ((isModifier && key === 'y') ||
        (isModifier && e.shiftKey && key === 'z')) {
      e.preventDefault()
      this.handleRedo()
      return
    }

    // Copy: Ctrl+C or Cmd+C
    if (isModifier && key === 'c') {
      e.preventDefault()
      this.handleCopy()
      return
    }

    // Cut: Ctrl+X or Cmd+X
    if (isModifier && key === 'x') {
      e.preventDefault()
      this.handleCut()
      return
    }

    // Paste: Ctrl+V or Cmd+V
    if (isModifier && key === 'v') {
      e.preventDefault()
      this.handlePaste()
    }
  }

  /**
   * Set up clipboard and undo/redo event handlers
   */
  setupClipboardHandlers () {
    // Global keyboard listener for copy/paste/undo/redo
    document.addEventListener('keydown', (e) => {
      this.handleKeyboardShortcut(e)
    })

    // Also support native paste event for external clipboard data
    document.addEventListener('paste', (e) => {
      if (!this.isSpreadsheetFocus()) { return }

      e.preventDefault()
      const clipboardData = e.clipboardData?.getData('text/plain')
      if (clipboardData) {
        this.handlePaste(clipboardData)
      }
    })
  }

  /**
   * Get the selection range (supports single cell or future multi-cell selection)
   */
  getSelectionRange () {
    if (!this.currentCell) { return null }

    // For now, just return current cell as both start and end
    // Later this will support multi-cell selection
    const coord = a1ToCoord(this.currentCell)
    return {
      startRow: coord.row,
      startCol: coord.col,
      endRow: coord.row,
      endCol: coord.col
    }
  }

  /**
   * Handle copy operation
   */
  handleCopy () {
    const range = this.getSelectionRange()
    if (!range) { return }

    // Build 2D array of cell data
    const data = []
    for (let row = range.startRow; row <= range.endRow; row++) {
      const rowData = []
      for (let col = range.startCol; col <= range.endCol; col++) {
        const coord = coordToA1(row, col)
        const cell = this.engine.getCell(coord)
        // Store the formula if it exists, otherwise the value
        rowData.push(cell.formula || cell.value || '')
      }
      data.push(rowData)
    }

    // Store internally
    this.copiedData = {
      data,
      startRow: range.startRow,
      startCol: range.startCol,
      rows: range.endRow - range.startRow + 1,
      cols: range.endCol - range.startCol + 1
    }

    // Convert to TSV format for system clipboard
    const tsvData = data.map(row => row.join('\t')).join('\n')

    // Copy to system clipboard
    navigator.clipboard.writeText(tsvData).then(() => {
      // Visual feedback
      this.showClipboardFeedback('Copied!')
    }).catch(() => {
      // Fallback: at least we have internal copiedData
      this.showClipboardFeedback('Copied (internal only)')
    })
  }

  /**
   * Handle cut operation (copy + clear)
   */
  handleCut () {
    const range = this.getSelectionRange()
    if (!range) { return }

    // First copy
    this.handleCopy()

    // Then clear the cells
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const coord = coordToA1(row, col)
        this.engine.clearCell(coord)

        // Explicitly clear the input value if this cell is currently focused
        // This makes cut operations immediately visible
        const input = document.getElementById(`cell-${coord}`)
        if (input && document.activeElement === input) {
          input.value = ''
        }
      }
    }

    this.showClipboardFeedback('Cut!')
  }

  /**
   * Handle paste operation
   *
   * @param {string} [externalData] - Optional external clipboard data
   */
  async handlePaste (externalData) {
    if (!this.currentCell) { return }

    let dataToPaste

    if (externalData) {
      // Parse TSV data from external clipboard
      dataToPaste = this.parseTSVData(externalData)
    } else if (this.copiedData) {
      // Use internal copied data
      dataToPaste = this.copiedData.data
    } else {
      // No internal data - try reading from system clipboard
      try {
        const clipboardText = await navigator.clipboard.readText()
        if (clipboardText) {
          dataToPaste = this.parseTSVData(clipboardText)
        } else {
          return // Nothing to paste
        }
      } catch (e) {
        // Clipboard read failed (permission denied or not supported)
        return
      }
    }

    // Get paste starting position
    const startCoord = a1ToCoord(this.currentCell)

    // Paste data
    for (let rowOffset = 0; rowOffset < dataToPaste.length; rowOffset++) {
      const row = startCoord.row + rowOffset
      if (row >= this.gridSize.rows) { break } // Don't paste beyond grid

      for (let colOffset = 0; colOffset < dataToPaste[rowOffset].length; colOffset++) {
        const col = startCoord.col + colOffset
        if (col >= this.gridSize.cols) { break } // Don't paste beyond grid

        const coord = coordToA1(row, col)
        const value = dataToPaste[rowOffset][colOffset]

        if (value === '') {
          this.engine.clearCell(coord)
        } else {
          this.engine.setCell(coord, value)
        }

        // Explicitly update the input value if this cell is currently focused
        // This makes pasted values immediately visible
        const input = document.getElementById(`cell-${coord}`)
        if (input && document.activeElement === input) {
          // Set the value directly (we know what we're pasting)
          // For formulas, show the formula; for values, show the value
          if (typeof value === 'string' && value.startsWith('=')) {
            input.value = value // Show formula when focused
          } else {
            input.value = value // Show value when focused
          }
        }
      }
    }

    this.showClipboardFeedback('Pasted!')
  }

  /**
   * Parse TSV (tab-separated values) data into 2D array
   *
   * @param {string} tsvData - TSV formatted string
   * @returns {string[][]} 2D array of cell values
   */
  parseTSVData (tsvData) {
    const lines = tsvData.split(/\r?\n/)
    return lines.map(line => line.split('\t'))
  }

  /**
   * Show temporary clipboard feedback message
   *
   * @param {string} message - Message to show
   */
  showClipboardFeedback (message) {
    // Create or reuse feedback element
    let feedback = document.getElementById('clipboard-feedback')
    if (!feedback) {
      feedback = document.createElement('div')
      feedback.id = 'clipboard-feedback'
      feedback.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4caf50;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        font-size: 14px;
        font-weight: 500;
        transition: opacity 0.3s;
      `
      document.body.appendChild(feedback)
    }

    feedback.textContent = message
    feedback.style.opacity = '1'

    // Clear any existing timeout
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout)
    }

    // Hide after 2 seconds
    this.feedbackTimeout = setTimeout(() => {
      feedback.style.opacity = '0'
    }, 2000)
  }

  /**
   * Handle undo operation
   */
  handleUndo () {
    const success = this.engine.undo()
    if (success) {
      this.showClipboardFeedback('Undo')

      // Update the currently focused cell display if needed
      if (this.currentCell) {
        const input = document.getElementById(`cell-${this.currentCell}`)
        if (input && document.activeElement !== input) {
          // Blur focused inputs to ensure synced values are displayed
          if (document.activeElement?.id?.startsWith('cell-')) {
            document.activeElement.blur()
          }
        }
      }
    } else {
      this.showClipboardFeedback('Nothing to undo')
    }
  }

  /**
   * Handle redo operation
   */
  handleRedo () {
    const success = this.engine.redo()
    if (success) {
      this.showClipboardFeedback('Redo')

      // Update the currently focused cell display if needed
      if (this.currentCell) {
        const input = document.getElementById(`cell-${this.currentCell}`)
        if (input && document.activeElement !== input) {
          // Blur focused inputs to ensure synced values are displayed
          if (document.activeElement?.id?.startsWith('cell-')) {
            document.activeElement.blur()
          }
        }
      }
    } else {
      this.showClipboardFeedback('Nothing to redo')
    }
  }
}
