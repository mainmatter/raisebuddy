/**
 * raisor/js/app.js
 *
 * RaiseCalculator - single-file UI driver for raisor/index.html
 *
 * Responsibilities:
 *  - Build combined candidate raises (full-time +500, part-time +500, 0.5% steps)
 *  - Remove duplicate rows (collapse candidates with same rounded yearly full-time)
 *  - For each rendered row, highlight the single snapped cell by wrapping its text in <strong>
 *    The snapped cell is one of:
 *      - Yearly (full-time)    [from full-time +500 source]
 *      - Yearly (part-time)    [from part-time +500 source]
 *      - Raise %               [from percent increments source]
 *  - Hide / show the "Yearly (part-time)" column using Bootstrap's `d-none` utility
 *  - Always display the monthly difference column
 *
 * Notes:
 *  - This file is intentionally a plain script (no ES module export). It auto-initializes
 *    on DOM ready and exposes `window.RaiseCalculator` and `window.raiseCalculatorInstance`.
 */

class RaiseCalculator {
  constructor(opts = {}) {
    const {
      currency = "#currency",
      fullTime = "#fullTimeYear",
      days = "#days",
      results = "#results",
      config = {},
    } = opts;

    this._els = {
      currency: this._resolveEl(currency),
      fullTime: this._resolveEl(fullTime),
      days: this._resolveEl(days),
      results: this._resolveEl(results),
    };

    this._cfg = Object.assign(
      {
        INCREMENT_AMOUNT: 500,
        INCREMENT_STEPS: 10,
        PERCENT_STEP: 0.5 / 100,
        PERCENT_STEPS: 20,
      },
      config,
    );

    // cached index of the "Yearly (part-time)" header column (0-based)
    this._partColIndex = null;

    this._onInput = this._onInput.bind(this);
  }

  init() {
    this._ensureElements();
    this._bindEvents();
    this._computePartColumnIndex();
    this.render();
    return this;
  }

  // Public render
  render() {
    const currency = this._els.currency.value || "EUR";
    const baseFull = Math.max(0, Number(this._els.fullTime.value) || 0);
    const days = Number(this._els.days.value) || 5;
    const partRatio = days / 5;
    const basePart = baseFull * partRatio;
    const baseMonthly = basePart / 12;

    // Hide/show part-time column using Bootstrap `d-none`
    const hidePart = days === 5;
    this._togglePartColumn(hidePart);

    // Build candidates
    const candidates = [];

    const pushCandidate = (obj) =>
      candidates.push({
        source: obj.source, // 'FT' | 'PT' | 'PCT'
        label: obj.label || "",
        fullYearly: Number(obj.fullYearly) || 0,
        partYearly: Number(obj.partYearly) || 0,
        monthly: Number(obj.monthly) || 0,
        raisePct: Number(obj.raisePct) || 0,
        monthlyDiff: Number(obj.monthlyDiff) || 0,
      });

    // Full-time +500 increments
    // Determine the percent target (as percentage) and the required steps to reach it.
    // We'll still compute enough +500 steps to cover the target, but we stop adding
    // rows once the computed raise percent would exceed the percent target (so the
    // table goes up to the configured percent target exactly).
    const percentTargetIncrease =
      baseFull * this._cfg.PERCENT_STEP * this._cfg.PERCENT_STEPS;
    const percentTargetPct =
      this._cfg.PERCENT_STEP * this._cfg.PERCENT_STEPS * 100;
    const requiredIncSteps =
      this._cfg.INCREMENT_AMOUNT > 0 && baseFull > 0
        ? Math.ceil(percentTargetIncrease / this._cfg.INCREMENT_AMOUNT)
        : this._cfg.INCREMENT_STEPS;
    const ftSteps = Math.max(this._cfg.INCREMENT_STEPS, requiredIncSteps);

    for (let i = 1; i <= ftSteps; i++) {
      const newFull = baseFull + this._cfg.INCREMENT_AMOUNT * i;
      const newPart = newFull * partRatio;
      const newMonthly = newPart / 12;
      const raisePct =
        baseFull > 0 ? ((newFull - baseFull) / baseFull) * 100 : 0;
      const monthlyDiff = newMonthly - baseMonthly;

      // Stop adding full-time +500 increments once the percent raise would exceed the percent target.
      // Allow equal to the target (<=). Only break when we have a valid baseFull to compare against.
      if (baseFull > 0 && raisePct > percentTargetPct) break;

      pushCandidate({
        source: "FT",
        label: `${i} × ${this._cfg.INCREMENT_AMOUNT}`,
        fullYearly: newFull,
        partYearly: newPart,
        monthly: newMonthly,
        raisePct,
        monthlyDiff,
      });
    }

    // Part-time +500 increments (implied full-time)
    // Use the same number of steps as full-time increments but stop once the percent target is exceeded.
    const ptSteps = ftSteps;
    for (let i = 1; i <= ptSteps; i++) {
      const newPartBase = basePart + this._cfg.INCREMENT_AMOUNT * i;
      const impliedFull = partRatio > 0 ? newPartBase / partRatio : baseFull;
      const newMonthly = newPartBase / 12;
      const raisePct =
        baseFull > 0 ? ((impliedFull - baseFull) / baseFull) * 100 : 0;
      const monthlyDiff = newMonthly - baseMonthly;

      // Stop adding part-time +500 increments once the percent raise would exceed the percent target.
      // Only break when baseFull is positive so we don't prematurely stop when baseFull is zero.
      if (baseFull > 0 && raisePct > percentTargetPct) break;

      pushCandidate({
        source: "PT",
        label: `${i} × ${this._cfg.INCREMENT_AMOUNT} (over part-time)`,
        fullYearly: impliedFull,
        partYearly: newPartBase,
        monthly: newMonthly,
        raisePct,
        monthlyDiff,
      });
    }

    // Percent increments over full-time (0.5% steps)
    for (let i = 1; i <= this._cfg.PERCENT_STEPS; i++) {
      const newFull = baseFull * (1 + this._cfg.PERCENT_STEP * i);
      const newPart = newFull * partRatio;
      const newMonthly = newPart / 12;
      const raisePct =
        baseFull > 0 ? ((newFull - baseFull) / baseFull) * 100 : 0;
      const monthlyDiff = newMonthly - baseMonthly;

      pushCandidate({
        source: "PCT",
        label: `${(this._cfg.PERCENT_STEP * 100 * i).toFixed(1)}%`,
        fullYearly: newFull,
        partYearly: newPart,
        monthly: newMonthly,
        raisePct,
        monthlyDiff,
      });
    }

    // Deduplicate by rounded yearly full-time amount (integer euros)
    const grouped = new Map();
    candidates.forEach((c) => {
      const key = Math.round(c.fullYearly);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(c);
    });

    // Prepare final rows: base current salary first
    this._clearRows();

    const base = {
      fullYearly: baseFull,
      partYearly: basePart,
      monthly: baseMonthly,
      raisePct: 0,
      monthlyDiff: 0,
    };

    this._appendRowForRendering(base, { snap: null, currency });

    // Sort keys ascending and render one row per unique key
    const keys = Array.from(grouped.keys()).sort((a, b) => a - b);
    const baseKey = Math.round(baseFull);
    for (const k of keys) {
      // Skip any candidate whose rounded yearly equals the base salary to avoid duplicate line
      if (k === baseKey) continue;

      const group = grouped.get(k);
      // Determine snap priority for this group:
      // Prefer FT (yearly snapshot) over PT (part-time) over PCT (percent)
      const hasFT = group.some((g) => g.source === "FT");
      const hasPT = group.some((g) => g.source === "PT");
      const hasPCT = group.some((g) => g.source === "PCT");

      // Choose representative candidate (prefer FT, else PT, else first)
      let rep = group[0];
      if (hasFT) rep = group.find((g) => g.source === "FT");
      else if (hasPT) rep = group.find((g) => g.source === "PT");

      // determine which cell to snap/highlight
      const snap = hasFT ? "FT" : hasPT ? "PT" : hasPCT ? "PCT" : null;

      // Additional "round" highlighting:
      // - highlightFull: any candidate in this group sits on an exact INCREMENT_AMOUNT boundary (e.g. multiple of 500)
      // - highlightPart: same for part-time yearly amount
      // - highlightPct: any candidate in this group falls exactly on a percent step (e.g. 0.5% increments)
      const percentStepPct = this._cfg.PERCENT_STEP * 100;
      const epsilon = 1e-6;

      const highlightFull = group.some((g) => {
        if (!Number.isFinite(g.fullYearly)) return false;
        const ratio = g.fullYearly / this._cfg.INCREMENT_AMOUNT;
        return Math.abs(ratio - Math.round(ratio)) < epsilon;
      });

      const highlightPart = group.some((g) => {
        if (!Number.isFinite(g.partYearly)) return false;
        const ratio = g.partYearly / this._cfg.INCREMENT_AMOUNT;
        return Math.abs(ratio - Math.round(ratio)) < epsilon;
      });

      const highlightPct = group.some((g) => {
        if (!Number.isFinite(g.raisePct)) return false;
        const ratio = g.raisePct / percentStepPct;
        return Math.abs(ratio - Math.round(ratio)) < epsilon;
      });

      this._appendRowForRendering(rep, {
        snap,
        currency,
        highlightFull,
        highlightPart,
        highlightPct,
      });
    }
  }

  // ---------- Helpers ----------

  _appendRowForRendering(candidate, opts = {}) {
    const {
      snap = null,
      currency = "EUR",
      highlightFull = false,
      highlightPart = false,
      highlightPct = false,
    } = opts;

    // Build column values (strings/html)
    // Columns: Yearly (full-time), Yearly (part-time), Monthly, Raise (%), Monthly difference

    const fullVal = this._formatCurrency(candidate.fullYearly, currency);
    const partVal = this._formatCurrency(candidate.partYearly, currency);
    const monthlyVal = this._formatCurrency(candidate.monthly, currency);
    const raisePctVal = `${candidate.raisePct.toFixed(2)}%`;
    const monthlyDiffVal = this._formatCurrency(
      candidate.monthlyDiff,
      currency,
    );

    // Render snapped cell with <strong> or apply "round" highlights as requested
    const fullCell =
      snap === "FT" || highlightFull
        ? { html: `<strong>${fullVal}</strong>` }
        : { text: fullVal };

    const partCell =
      snap === "PT" || highlightPart
        ? { html: `<strong>${partVal}</strong>`, className: "part-col" }
        : { text: partVal, className: "part-col" };

    const pctCell =
      snap === "PCT" || highlightPct
        ? { html: `<strong>${raisePctVal}</strong>` }
        : { text: raisePctVal };

    // monthly diff always displayed (no part-only behavior)
    const diffCell = { text: monthlyDiffVal };

    // Append row (cells order matches header)
    this._addRow([fullCell, partCell, monthlyVal, pctCell, diffCell]);
  }

  _resolveEl(selectorOrEl) {
    if (!selectorOrEl) return null;
    if (typeof selectorOrEl === "string")
      return document.querySelector(selectorOrEl);
    if (selectorOrEl instanceof HTMLElement) return selectorOrEl;
    return null;
  }

  _ensureElements() {
    const missing = [];
    for (const [k, el] of Object.entries(this._els)) {
      if (!el) missing.push(k);
    }
    if (missing.length) {
      console.error("RaiseCalculator: missing elements:", missing);
      throw new Error("Missing required elements: " + missing.join(", "));
    }
  }

  _bindEvents() {
    const { currency, fullTime, days } = this._els;
    [currency, fullTime, days].forEach((el) =>
      el.addEventListener("input", this._onInput),
    );
  }

  _onInput() {
    this.render();
  }

  // Compute header index of the "Yearly (part-time)" column so we can toggle it by index
  _computePartColumnIndex() {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    this._partColIndex = null;
    for (let i = 0; i < ths.length; i++) {
      const th = ths[i];
      const t = (th.textContent || "").trim().toLowerCase();
      if (th.classList.contains("part-col") || t.includes("part-time")) {
        this._partColIndex = i;
        return;
      }
    }
    // fallback: try to find by header text 'yearly (part-time)'
    this._partColIndex = ths.findIndex((th) =>
      (th.textContent || "").toLowerCase().includes("part-time"),
    );
    if (this._partColIndex === -1) this._partColIndex = null;
  }

  // Toggle the part-time column using Bootstrap `d-none` class on header and body cells
  _togglePartColumn(hide) {
    // Recompute in case DOM changed
    this._computePartColumnIndex();
    const table = this._els.results ? this._els.results.closest("table") : null;
    if (!table || this._partColIndex === null) return;

    const ths = Array.from(table.querySelectorAll("thead th"));
    const header = ths[this._partColIndex];
    if (header) {
      if (hide) header.classList.add("d-none");
      else header.classList.remove("d-none");
    }

    const rows = Array.from(table.querySelectorAll("tbody tr"));
    rows.forEach((tr) => {
      const cells = Array.from(tr.children);
      if (cells.length > this._partColIndex) {
        const td = cells[this._partColIndex];
        if (td) {
          if (hide) td.classList.add("d-none");
          else td.classList.remove("d-none");
        }
      }
    });
  }

  _clearRows() {
    this._els.results.innerHTML = "";
  }

  _addRow(cells, opts = {}) {
    const tr = document.createElement("tr");
    if (opts.isSeparator) tr.className = "table-light";

    // Snapshot header cells so newly added rows mirror header hide state automatically
    const table = this._els.results ? this._els.results.closest("table") : null;
    const headerCells = table
      ? Array.from(table.querySelectorAll("thead th"))
      : [];

    cells.forEach((cell, idx) => {
      const td = document.createElement("td");

      if (cell == null) {
        td.textContent = "";
      } else if (typeof cell === "string" || typeof cell === "number") {
        td.textContent = String(cell);
      } else if (typeof cell === "object") {
        if (cell.html !== undefined) td.innerHTML = cell.html;
        else td.textContent = cell.text || "";

        if (cell.className) td.className = cell.className;
        if (cell.style && typeof cell.style === "object")
          Object.assign(td.style, cell.style);
      } else {
        td.textContent = "";
      }

      // If the corresponding header cell is hidden via d-none, mirror that state
      if (headerCells[idx] && headerCells[idx].classList.contains("d-none")) {
        td.classList.add("d-none");
      }

      tr.appendChild(td);
    });

    this._els.results.appendChild(tr);
  }

  // Format currency: integer, locale-aware thousand separators
  _formatCurrency(value, currency = "EUR") {
    const n = Math.round(Number(value) || 0);
    const formatted = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (currency === "EUR") return `${formatted}€`;
    if (currency === "USD") return `$${formatted}`;
    return `${formatted} ${String(currency)}`;
  }
}

/* Auto-bootstrap */
(function () {
  function bootstrap() {
    try {
      const instance = new RaiseCalculator().init();
      if (typeof window !== "undefined") {
        window.RaiseCalculator = RaiseCalculator;
        window.raiseCalculatorInstance = instance;
      }
    } catch (err) {
      console.error("RaiseCalculator bootstrap failed:", err);
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrap);
    } else {
      setTimeout(bootstrap, 0);
    }
  }
})();
