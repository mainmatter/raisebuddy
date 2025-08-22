/**
 * Pure buildRows function and helpers extracted from the app logic.
 *
 * Refactored into small helper functions. The module exports the primary
 * `buildRows` function as the module export (for compatibility with existing tests),
 * and exposes helper functions under `module.exports.helpers`.
 *
 * Each helper has a short comment describing what it returns.
 */

/**
 * Normalize and provide default configuration.
 * @param {Object} cfg
 * @returns {Object} normalized config with numeric fields
 */
function normalizeCfg(cfg = {}) {
  return Object.assign(
    {
      INCREMENT_AMOUNT: 500,
      INCREMENT_STEPS: 10,
      PERCENT_STEP: 0.5 / 100,
      PERCENT_STEPS: 20,
    },
    cfg,
  );
}

/**
 * Compute base derived numbers.
 * @param {number} baseFull
 * @param {number} days
 * @returns {{ baseFullNum: number, partRatio: number, basePart: number, baseMonthly: number }}
 */
function computeBaseValues(baseFull, days) {
  const baseFullNum = Math.max(0, Number(baseFull) || 0);
  const partRatio = (Number(days) || 5) / 5;
  const basePart = baseFullNum * partRatio;
  const baseMonthly = basePart / 12;
  return { baseFullNum, partRatio, basePart, baseMonthly };
}

/**
 * Round up `value` to the nearest `increment`.
 * If value is already an exact multiple of increment, returns value + increment.
 * @param {number} value
 * @param {number} increment
 * @returns {number}
 */
function roundUpToIncrement(value, increment) {
  if (!increment || increment === 0) return value;
  if (value % increment === 0) return value + increment;
  return Math.ceil(value / increment) * increment;
}

/**
 * Build raw candidate entries (no dedupe).
 * Returns an array of candidate objects:
 * {
 *   source: 'BASE'|'FT'|'PT'|'PCT',
 *   label: string,
 *   fullYearly: number,
 *   partYearly: number,
 *   monthly: number,
 *   raisePct: number,
 *   monthlyDiff: number,
 *   yearlyDiff: number
 * }
 *
 * @param {Object} params
 * @param {number} params.baseFullNum
 * @param {number} params.partRatio
 * @param {number} params.baseMonthly
 * @param {number} params.basePart
 * @param {Object} params.cfg
 * @returns {Array<Object>}
 */
function buildCandidates({
  baseFullNum,
  partRatio,
  baseMonthly,
  basePart,
  cfg,
}) {
  const candidates = [];
  const pushCandidate = (obj) =>
    candidates.push({
      source: obj.source || "BASE",
      label: obj.label || "",
      fullYearly: Number(obj.fullYearly) || 0,
      partYearly: Number(obj.partYearly) || 0,
      monthly: Number(obj.monthly) || 0,
      raisePct: Number(obj.raisePct) || 0,
      monthlyDiff: Number(obj.monthlyDiff) || 0,
      yearlyDiff: Number(obj.yearlyDiff) || 0,
    });

  const percentTargetPct = cfg.PERCENT_STEP * cfg.PERCENT_STEPS * 100;
  const percentTargetFactor = 1 + cfg.PERCENT_STEP * cfg.PERCENT_STEPS;
  const targetFull = baseFullNum * percentTargetFactor;

  // 1) Base
  pushCandidate({
    source: "BASE",
    label: "current",
    fullYearly: baseFullNum,
    partYearly: basePart,
    monthly: baseMonthly,
    raisePct: 0,
    monthlyDiff: 0,
    yearlyDiff: 0,
  });

  // 2) Rounded FT (round up to increment boundary)
  let secondFull;
  if (cfg.INCREMENT_AMOUNT > 0) {
    if (baseFullNum % cfg.INCREMENT_AMOUNT === 0) {
      secondFull = baseFullNum + cfg.INCREMENT_AMOUNT;
    } else {
      secondFull =
        Math.ceil(baseFullNum / cfg.INCREMENT_AMOUNT) * cfg.INCREMENT_AMOUNT;
    }
  } else {
    secondFull = baseFullNum;
  }

  if (secondFull !== baseFullNum) {
    const newPart = secondFull * partRatio;
    const newMonthly = newPart / 12;
    const raisePct =
      baseFullNum > 0 ? ((secondFull - baseFullNum) / baseFullNum) * 100 : 0;
    const monthlyDiff = newMonthly - baseMonthly;
    const yearlyDiff = secondFull - baseFullNum;
    pushCandidate({
      source: "FT",
      label: "rounded",
      fullYearly: secondFull,
      partYearly: newPart,
      monthly: newMonthly,
      raisePct,
      monthlyDiff,
      yearlyDiff,
    });
  }

  // 3) Percent increments (PCT)
  for (let i = 1; i <= cfg.PERCENT_STEPS; i++) {
    const newFull = baseFullNum * (1 + cfg.PERCENT_STEP * i);
    const newPart = newFull * partRatio;
    const newMonthly = newPart / 12;
    const raisePct =
      baseFullNum > 0 ? ((newFull - baseFullNum) / baseFullNum) * 100 : 0;
    const monthlyDiff = newMonthly - baseMonthly;
    const yearlyDiff = newFull - baseFullNum;

    pushCandidate({
      source: "PCT",
      label: `${(cfg.PERCENT_STEP * 100 * i).toFixed(1)}%`,
      fullYearly: newFull,
      partYearly: newPart,
      monthly: newMonthly,
      raisePct,
      monthlyDiff,
      yearlyDiff,
    });
  }

  // 4) FT increments
  if (cfg.INCREMENT_AMOUNT > 0) {
    let startFull =
      typeof secondFull === "number"
        ? secondFull
        : baseFullNum + cfg.INCREMENT_AMOUNT;
    if (startFull <= baseFullNum)
      startFull = baseFullNum + cfg.INCREMENT_AMOUNT;

    for (
      let val = startFull;
      val <= targetFull + 1e-8;
      val += cfg.INCREMENT_AMOUNT
    ) {
      const newFull = val;
      const newPart = newFull * partRatio;
      const newMonthly = newPart / 12;
      const raisePct =
        baseFullNum > 0 ? ((newFull - baseFullNum) / baseFullNum) * 100 : 0;
      const monthlyDiff = newMonthly - baseMonthly;

      // include only up to target (allow equal)
      if (baseFullNum > 0 && raisePct > percentTargetPct) break;

      pushCandidate({
        source: "FT",
        label: `+${cfg.INCREMENT_AMOUNT}`,
        fullYearly: newFull,
        partYearly: newPart,
        monthly: newMonthly,
        raisePct,
        monthlyDiff,
        yearlyDiff: newFull - baseFullNum,
      });
    }
  }

  // 5) PT increments
  if (cfg.INCREMENT_AMOUNT > 0 && partRatio > 0) {
    let startPart;
    if (typeof secondFull === "number") {
      startPart = secondFull * partRatio;
    } else {
      if (basePart % cfg.INCREMENT_AMOUNT === 0) {
        startPart = basePart + cfg.INCREMENT_AMOUNT;
      } else {
        startPart =
          Math.ceil(basePart / cfg.INCREMENT_AMOUNT) * cfg.INCREMENT_AMOUNT;
      }
    }
    if (startPart <= basePart) startPart = basePart + cfg.INCREMENT_AMOUNT;

    for (
      let partVal = startPart;
      partVal <= targetFull * partRatio + 1e-8;
      partVal += cfg.INCREMENT_AMOUNT
    ) {
      const newPartBase = partVal;
      const impliedFull = partRatio > 0 ? newPartBase / partRatio : baseFullNum;
      const newMonthly = newPartBase / 12;
      const raisePct =
        baseFullNum > 0 ? ((impliedFull - baseFullNum) / baseFullNum) * 100 : 0;
      const monthlyDiff = newMonthly - baseMonthly;

      if (baseFullNum > 0 && raisePct > percentTargetPct) break;

      pushCandidate({
        source: "PT",
        label: `+${cfg.INCREMENT_AMOUNT} (part)`,
        fullYearly: impliedFull,
        partYearly: newPartBase,
        monthly: newMonthly,
        raisePct,
        monthlyDiff,
        yearlyDiff: impliedFull - baseFullNum,
      });
    }
  }

  return candidates;
}

/**
 * Dedupe candidates by Math.round(fullYearly) with a given priority mapping.
 * Returns a Map from roundedKey -> representative candidate
 * @param {Array<Object>} candidates
 * @param {Object} priority map (e.g., { FT: 4, PT: 3, PCT: 2, BASE: 1 })
 * @returns {Map<number, Object>}
 */
function dedupeCandidatesByRoundedFull(
  candidates,
  priority = { FT: 4, PT: 3, PCT: 2, BASE: 1 },
) {
  const rowsMap = new Map();
  candidates.forEach((c) => {
    const key = Math.round(c.fullYearly);
    if (!rowsMap.has(key)) rowsMap.set(key, c);
    else {
      const existing = rowsMap.get(key);
      const newPr = priority[c.source] || 0;
      const existingPr = priority[existing.source] || 0;
      if (newPr > existingPr) rowsMap.set(key, c);
    }
  });
  return rowsMap;
}

/**
 * Determine highlightedCells for a representative candidate given config.
 * Returns an array of strings from: 'fullYearly', 'partYearly', 'raisePct'
 * @param {Object} rep candidate
 * @param {Object} cfg
 * @returns {Array<string>}
 */
function computeHighlightedCells(rep, cfg) {
  const percentStepPct = cfg.PERCENT_STEP * 100;
  const epsilon = 1e-6;
  const highlighted = new Set();

  // snap based on source
  if (rep.source === "FT") highlighted.add("fullYearly");
  if (rep.source === "PT") highlighted.add("partYearly");
  if (rep.source === "PCT") highlighted.add("raisePct");

  // rounding-based highlights (round to increment or percent step)
  if (
    Number.isFinite(rep.fullYearly) &&
    Math.abs(
      rep.fullYearly / cfg.INCREMENT_AMOUNT -
        Math.round(rep.fullYearly / cfg.INCREMENT_AMOUNT),
    ) < epsilon
  ) {
    highlighted.add("fullYearly");
  }
  if (
    Number.isFinite(rep.partYearly) &&
    Math.abs(
      rep.partYearly / cfg.INCREMENT_AMOUNT -
        Math.round(rep.partYearly / cfg.INCREMENT_AMOUNT),
    ) < epsilon
  ) {
    highlighted.add("partYearly");
  }
  if (
    Number.isFinite(rep.raisePct) &&
    Math.abs(
      rep.raisePct / percentStepPct - Math.round(rep.raisePct / percentStepPct),
    ) < epsilon
  ) {
    highlighted.add("raisePct");
  }

  return Array.from(highlighted);
}

/**
 * Finalize rows array for consumption by UI/tests. Base row comes first and then
 * representative rows in ascending rounded fullYearly order (excluding baseKey).
 *
 * Each row has:
 * {
 *   source, label,
 *   fullYearly, partYearly, monthly, raisePct, monthlyDiff, yearlyDiff,
 *   highlightedCells: Array<string>
 * }
 *
 * @param {Map<number,Object>} rowsMap
 * @param {Object} baseVals { baseFullNum, basePart, baseMonthly }
 * @param {Object} cfg
 * @returns {Array<Object>}
 */
function finalizeRows(rowsMap, baseVals, cfg) {
  const finalRows = [];

  const baseObj = {
    source: "BASE",
    label: "current",
    fullYearly: baseVals.baseFullNum,
    partYearly: baseVals.basePart,
    monthly: baseVals.baseMonthly,
    raisePct: 0,
    monthlyDiff: 0,
    yearlyDiff: 0,
    highlightedCells: [],
  };
  finalRows.push(baseObj);

  const keys = Array.from(rowsMap.keys()).sort((a, b) => a - b);
  const baseKey = Math.round(baseVals.baseFullNum);

  for (const k of keys) {
    if (k === baseKey) continue;
    const rep = rowsMap.get(k);
    if (!rep) continue;

    const highlightedCells = computeHighlightedCells(rep, cfg);

    finalRows.push({
      source: rep.source,
      label: rep.label,
      fullYearly: Number(rep.fullYearly),
      partYearly: Number(rep.partYearly),
      monthly: Number(rep.monthly),
      raisePct: Number(rep.raisePct),
      monthlyDiff: Number(rep.monthlyDiff),
      yearlyDiff: Number(rep.yearlyDiff),
      highlightedCells,
    });
  }

  return finalRows;
}

/**
 * Primary exported function.
 * Accepts an options object:
 * { baseFull: number, days: number, config: object }
 *
 * Returns an array of row objects (see finalizeRows doc).
 *
 * This function is pure (no DOM access).
 *
 * @param {Object} opts
 * @returns {Array<Object>}
 */
function buildRows(opts = {}) {
  const { baseFull = 0, days = 5, config = {} } = opts;
  const cfg = normalizeCfg(config);
  const baseVals = computeBaseValues(baseFull, days);

  const candidates = buildCandidates({
    baseFullNum: baseVals.baseFullNum,
    partRatio: baseVals.partRatio,
    baseMonthly: baseVals.baseMonthly,
    basePart: baseVals.basePart,
    cfg,
  });

  const rowsMap = dedupeCandidatesByRoundedFull(candidates);
  const final = finalizeRows(rowsMap, baseVals, cfg);
  return final;
}

/* Exporting strategy:
 * - Provide a plain `exportsObj` holding the public API.
 * - If CommonJS (module.exports) is available, attach the function + helpers there.
 * - Always expose a safe browser-global API (window / globalThis) without referencing
 *   `module` in environments where it's undefined.
 */
const exportsObj = {
  buildRows,
  helpers: {
    normalizeCfg,
    computeBaseValues,
    roundUpToIncrement,
    buildCandidates,
    dedupeCandidatesByRoundedFull,
    computeHighlightedCells,
    finalizeRows,
  },
};

// CommonJS export (guarded to avoid ReferenceError in browsers)
if (typeof module !== "undefined" && module && module.exports) {
  try {
    // Export the buildRows function as the module export (backwards compat)
    module.exports = exportsObj.buildRows;
    // Attach helpers for tests/tools that expect them on module.exports
    module.exports.buildRows = exportsObj.buildRows;
    module.exports.helpers = exportsObj.helpers;
  } catch (err) {
    // ignore if module is not writable
  }
}

// Expose a safe browser/global API (window preferred, fallback to globalThis)
try {
  if (typeof window !== "undefined") {
    window.RaiseBuddyLogic = Object.assign({}, exportsObj.helpers, {
      buildRows: exportsObj.buildRows,
    });
    window.buildRows = exportsObj.buildRows;
  } else if (typeof globalThis !== "undefined") {
    globalThis.RaiseBuddyLogic = Object.assign({}, exportsObj.helpers, {
      buildRows: exportsObj.buildRows,
    });
    globalThis.buildRows = exportsObj.buildRows;
  }
} catch (err) {
  // ignore in constrained environments
}
