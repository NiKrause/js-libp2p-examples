import * as Y from "yjs";

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
 * Converts letter(s) to column number (A -> 0, Z -> 25, AA -> 26)
 */
function letterToCol(letter) {
  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + letter.charCodeAt(i) - 64;
  }
  return col - 1;
}

/**
 * Converts row/col indices to A1 notation
 */
export function coordToA1(row, col) {
  return colToLetter(col) + (row + 1);
}

/**
 * Converts A1 notation to {row, col} indices
 */
export function a1ToCoord(a1) {
  const match = a1.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    col: letterToCol(match[1]),
    row: parseInt(match[2]) - 1,
  };
}

/**
 * Parse cell references from a formula
 * Returns array of cell coordinates (e.g., ['A1', 'B2'])
 */
function parseCellRefs(formula) {
  const refs = [];
  const regex = /\b([A-Z]+\d+)\b/g;
  let match;
  while ((match = regex.exec(formula)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

/**
 * Parse range references like A1:A10
 * Returns array of all cells in range
 */
function parseRange(range) {
  const match = range.match(/^([A-Z]+\d+):([A-Z]+\d+)$/);
  if (!match) return [range];

  const start = a1ToCoord(match[1]);
  const end = a1ToCoord(match[2]);
  if (!start || !end) return [range];

  const cells = [];
  for (let row = start.row; row <= end.row; row++) {
    for (let col = start.col; col <= end.col; col++) {
      cells.push(coordToA1(row, col));
    }
  }
  return cells;
}

export class SpreadsheetEngine {
  constructor(yjsDoc) {
    this.cells = yjsDoc.getMap("cells");
    this.dependencyGraph = new Map(); // cellId -> Set of dependent cellIds
    this.observers = new Set();

    // Watch for changes to recalculate
    this.cells.observeDeep((events) => {
      this.handleDeepCellChanges(events);
    });
  }

  /**
   * Set a cell value or formula
   */
  setCell(coord, value) {
    // Get or create a Yjs Map for this cell
    let cellData = this.cells.get(coord);
    if (!cellData) {
      cellData = new Y.Map();
      this.cells.set(coord, cellData);
    }

    // Clear old dependencies
    this.removeDependencies(coord);

    if (typeof value === "string" && value.startsWith("=")) {
      // It's a formula
      const formula = value;
      const refs = this.extractReferences(formula);

      // Build dependency graph
      for (const ref of refs) {
        if (!this.dependencyGraph.has(ref)) {
          this.dependencyGraph.set(ref, new Set());
        }
        this.dependencyGraph.get(ref).add(coord);
      }

      // Check for circular references
      if (this.hasCircularReference(coord)) {
        cellData.set("value", "#CIRCULAR!");
        cellData.set("formula", formula);
        cellData.set("error", true);
      } else {
        // Evaluate the formula
        const result = this.evaluate(formula, coord);
        cellData.set("value", result);
        cellData.set("formula", formula);
        cellData.set("error", false);
      }
    } else {
      // Raw value
      cellData.set("value", value);
      cellData.set("formula", null);
      cellData.set("error", false);
    }
  }

  /**
   * Get cell data
   */
  getCell(coord) {
    const cellData = this.cells.get(coord);
    if (!cellData) return { value: "", formula: null, error: false };

    return {
      value: cellData.get("value") || "",
      formula: cellData.get("formula") || null,
      error: cellData.get("error") || false,
    };
  }

  /**
   * Extract all cell references from formula (including ranges)
   */
  extractReferences(formula) {
    const refs = new Set();

    // Find SUM(A1:A10) style ranges
    const rangeRegex = /\b([A-Z]+\d+:[A-Z]+\d+)\b/g;
    let match;
    while ((match = rangeRegex.exec(formula)) !== null) {
      const cells = parseRange(match[1]);
      cells.forEach((cell) => refs.add(cell));
    }

    // Find individual cell references
    const cellRefs = parseCellRefs(formula);
    cellRefs.forEach((ref) => refs.add(ref));

    return Array.from(refs);
  }

  /**
   * Evaluate a formula
   */
  evaluate(formula, currentCell) {
    try {
      // Remove leading =
      let expr = formula.substring(1).trim();

      // Handle SUM function
      expr = expr.replace(/SUM\(([A-Z]+\d+:[A-Z]+\d+)\)/gi, (match, range) => {
        const cells = parseRange(range);
        const values = cells.map((coord) => {
          const cell = this.getCell(coord);
          const num = parseFloat(cell.value);
          return isNaN(num) ? 0 : num;
        });
        return values.reduce((sum, val) => sum + val, 0);
      });

      // Replace cell references with their values
      expr = expr.replace(/\b([A-Z]+\d+)\b/g, (match) => {
        if (match === currentCell) return "0"; // Prevent self-reference
        const cell = this.getCell(match);
        const num = parseFloat(cell.value);
        return isNaN(num) ? "0" : num.toString();
      });

      // Evaluate the expression safely
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${expr})`)();

      if (typeof result === "number" && isFinite(result)) {
        return result;
      }
      return "#ERROR!";
    } catch (err) {
      return "#ERROR!";
    }
  }

  /**
   * Check for circular references using DFS
   */
  hasCircularReference(coord, visited = new Set(), path = new Set()) {
    if (path.has(coord)) return true;
    if (visited.has(coord)) return false;

    visited.add(coord);
    path.add(coord);

    const dependents = this.dependencyGraph.get(coord);
    if (dependents) {
      for (const dependent of dependents) {
        if (this.hasCircularReference(dependent, visited, path)) {
          return true;
        }
      }
    }

    path.delete(coord);
    return false;
  }

  /**
   * Remove cell from dependency graph
   */
  removeDependencies(coord) {
    // Remove this cell from all dependency lists
    for (const [ref, dependents] of this.dependencyGraph.entries()) {
      dependents.delete(coord);
    }
  }

  /**
   * Handle deep Yjs cell changes (including nested Y.Map changes)
   */
  handleDeepCellChanges(events) {
    const changedCells = new Set();

    for (const event of events) {
      if (event.target === this.cells) {
        // Changes to the cells map itself (adding/removing cells)
        event.changes.keys.forEach((change, key) => {
          changedCells.add(key);
        });
      } else {
        // Changes to a nested Y.Map (cell data)
        // Find which cell this Y.Map belongs to
        for (const [coord, cellData] of this.cells.entries()) {
          if (cellData === event.target) {
            changedCells.add(coord);
            break;
          }
        }
      }
    }

    this.processChangedCells(Array.from(changedCells));
  }

  /**
   * Process changed cells and trigger recalculation
   */
  processChangedCells(changedCells) {
    // Find all cells that depend on changed cells
    const toRecalculate = new Set();
    const queue = [...changedCells];
    const visited = new Set();

    while (queue.length > 0) {
      const coord = queue.shift();
      if (visited.has(coord)) continue;
      visited.add(coord);

      const dependents = this.dependencyGraph.get(coord);
      if (dependents) {
        dependents.forEach((dep) => {
          toRecalculate.add(dep);
          queue.push(dep);
        });
      }
    }

    // Recalculate affected cells
    for (const coord of toRecalculate) {
      const cellData = this.cells.get(coord);
      if (cellData && cellData.get("formula")) {
        const formula = cellData.get("formula");
        const result = this.evaluate(formula, coord);
        cellData.set("value", result);
      }
    }

    // Notify observers of all changes
    changedCells.forEach((coord) => this.notifyObservers(coord));
    toRecalculate.forEach((coord) => this.notifyObservers(coord));
  }

  /**
   * Register an observer for cell changes
   */
  onChange(callback) {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  /**
   * Notify all observers of a change
   */
  notifyObservers(coord) {
    this.observers.forEach((callback) => callback(coord));
  }

  /**
   * Get all cells in the spreadsheet
   */
  getAllCells() {
    const cells = new Map();
    for (const [coord, cellData] of this.cells.entries()) {
      cells.set(coord, {
        value: cellData.get("value") || "",
        formula: cellData.get("formula") || null,
        error: cellData.get("error") || false,
      });
    }
    return cells;
  }

  /**
   * Clear a cell
   */
  clearCell(coord) {
    this.removeDependencies(coord);
    this.cells.delete(coord);
    this.notifyObservers(coord);
  }
}
