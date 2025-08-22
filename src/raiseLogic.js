/**
 * raisebuddy/js/app.js
 *
 * RaiseCalculator - single-file UI driver for raisebuddy/index.html
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

    // Set of highlighted row keys (strings)
    this._highlighted = new Set();

    // Reference to the optional "Reset highlighted rows" button
    this._resetBtn = null;

    // Bind instance methods
    this._onInput = this._onInput.bind(this);
    this._onRowClick = this._onRowClick.bind(this);
    this._onResetClick = this._onResetClick
      ? this._onResetClick.bind(this)
      : null;
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
        source: obj.source, // 'FT' | 'PT' | 'PCT' | 'BASE'
        label: obj.label || "",
        fullYearly: Number(obj.fullYearly) || 0,
        partYearly: Number(obj.partYearly) || 0,
        monthly: Number(obj.monthly) || 0,
        raisePct: Number(obj.raisePct) || 0,
        monthlyDiff: Number(obj.monthlyDiff) || 0,
        yearlyDiff: Number(obj.yearlyDiff) || 0,
      });

    // Percent target (absolute and percent)
    const percentTargetPct =
      this._cfg.PERCENT_STEP * this._cfg.PERCENT_STEPS * 100;
    const percentTargetFactor =
      1 + this._cfg.PERCENT_STEP * this._cfg.PERCENT_STEPS;
    const targetFull = baseFull * percentTargetFactor;

    // 1) Add the current salary (base)
    pushCandidate({
      source: "BASE",
      label: "current",
      fullYearly: baseFull,
      partYearly: basePart,
      monthly: baseMonthly,
      raisePct: 0,
      monthlyDiff: 0,
      yearlyDiff: 0,
    });

    // 2) Round up the current salary to the nearest INCREMENT_AMOUNT boundary (but if already exact, use next +INCREMENT)
    let secondFull;
    if (this._cfg.INCREMENT_AMOUNT > 0) {
      if (baseFull % this._cfg.INCREMENT_AMOUNT === 0) {
        secondFull = baseFull + this._cfg.INCREMENT_AMOUNT;
      } else {
        secondFull =
          Math.ceil(baseFull / this._cfg.INCREMENT_AMOUNT) *
          this._cfg.INCREMENT_AMOUNT;
      }
    } else {
      secondFull = baseFull;
    }

    if (secondFull !== baseFull) {
      const newPart = secondFull * partRatio;
      const newMonthly = newPart / 12;
      const raisePct =
        baseFull > 0 ? ((secondFull - baseFull) / baseFull) * 100 : 0;
      const monthlyDiff = newMonthly - baseMonthly;
      const yearlyDiff = secondFull - baseFull;
      pushCandidate({
        source: "FT",
        label: `rounded`,
        fullYearly: secondFull,
        partYearly: newPart,
        monthly: newMonthly,
        raisePct,
        monthlyDiff,
        yearlyDiff,
      });
    }

    // 3) Add percent increments (0.5% steps) up to the target (1..PERCENT_STEPS)
    for (let i = 1; i <= this._cfg.PERCENT_STEPS; i++) {
      const newFull = baseFull * (1 + this._cfg.PERCENT_STEP * i);
      const newPart = newFull * partRatio;
      const newMonthly = newPart / 12;
      const raisePct =
        baseFull > 0 ? ((newFull - baseFull) / baseFull) * 100 : 0;
      const monthlyDiff = newMonthly - baseMonthly;
      const yearlyDiff = newFull - baseFull;

      pushCandidate({
        source: "PCT",
        label: `${(this._cfg.PERCENT_STEP * 100 * i).toFixed(1)}%`,
        fullYearly: newFull,
        partYearly: newPart,
        monthly: newMonthly,
        raisePct,
        monthlyDiff,
        yearlyDiff,
      });
    }

    // 4) +500 increments for full-time from the rounded-up (secondFull) up to and including the percent target
    if (this._cfg.INCREMENT_AMOUNT > 0) {
      // start from secondFull if it's defined, otherwise use baseFull + INCREMENT
      let startFull =
        typeof secondFull === "number"
          ? secondFull
          : baseFull + this._cfg.INCREMENT_AMOUNT;
      // Ensure startFull is at least baseFull + INCREMENT_AMOUNT
      if (startFull <= baseFull)
        startFull = baseFull + this._cfg.INCREMENT_AMOUNT;

      for (
        let val = startFull;
        val <= targetFull + 1e-8;
        val += this._cfg.INCREMENT_AMOUNT
      ) {
        const newFull = val;
        const newPart = newFull * partRatio;
        const newMonthly = newPart / 12;
        const raisePct =
          baseFull > 0 ? ((newFull - baseFull) / baseFull) * 100 : 0;
        const monthlyDiff = newMonthly - baseMonthly;

        // include only up to target (allow equal)
        if (baseFull > 0 && raisePct > percentTargetPct) break;

        pushCandidate({
          source: "FT",
          label: `+${this._cfg.INCREMENT_AMOUNT}`,
          fullYearly: newFull,
          partYearly: newPart,
          monthly: newMonthly,
          raisePct,
          monthlyDiff,
          yearlyDiff: newFull - baseFull,
        });
      }
    }

    // 5) +500 increments for part-time from the rounded-up part value up to the percent target
    if (this._cfg.INCREMENT_AMOUNT > 0 && partRatio > 0) {
      // compute rounded up part-yearly equivalent to secondFull (if secondFull exists) or to basePart
      let startPart;
      if (typeof secondFull === "number") {
        startPart = secondFull * partRatio;
      } else {
        if (basePart % this._cfg.INCREMENT_AMOUNT === 0) {
          startPart = basePart + this._cfg.INCREMENT_AMOUNT;
        } else {
          startPart =
            Math.ceil(basePart / this._cfg.INCREMENT_AMOUNT) *
            this._cfg.INCREMENT_AMOUNT;
        }
      }
      if (startPart <= basePart)
        startPart = basePart + this._cfg.INCREMENT_AMOUNT;

      for (
        let partVal = startPart;
        partVal <= targetFull * partRatio + 1e-8;
        partVal += this._cfg.INCREMENT_AMOUNT
      ) {
        const newPartBase = partVal;
        const impliedFull = partRatio > 0 ? newPartBase / partRatio : baseFull;
        const newMonthly = newPartBase / 12;
        const raisePct =
          baseFull > 0 ? ((impliedFull - baseFull) / baseFull) * 100 : 0;
        const monthlyDiff = newMonthly - baseMonthly;

        if (baseFull > 0 && raisePct > percentTargetPct) break;

        pushCandidate({
          source: "PT",
          label: `+${this._cfg.INCREMENT_AMOUNT} (part)`,
          fullYearly: impliedFull,
          partYearly: newPartBase,
          monthly: newMonthly,
          raisePct,
          monthlyDiff,
          yearlyDiff: impliedFull - baseFull,
        });
      }
    }

    // 6) Sort by full-yearly and dedupe by rounded integer full-yearly (keep the highest-priority source for a given rounded full)
    // Priority order: FT > PT > PCT > BASE
    const PRIORITY = { FT: 4, PT: 3, PCT: 2, BASE: 1 };
    const rowsMap = new Map();
    candidates.forEach((c) => {
      const key = Math.round(c.fullYearly);
      if (!rowsMap.has(key)) {
        rowsMap.set(key, c);
      } else {
        const existing = rowsMap.get(key);
        const newPr = PRIORITY[c.source] || 0;
        const existingPr = PRIORITY[existing.source] || 0;
        if (newPr > existingPr) {
          rowsMap.set(key, c);
        }
      }
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

    // Render deduped rows in ascending full-yearly order
    const keys = Array.from(rowsMap.keys()).sort((a, b) => a - b);
    const baseKey = Math.round(baseFull);
    const percentStepPct = this._cfg.PERCENT_STEP * 100;
    const epsilon = 1e-6;

    for (const k of keys) {
      // Skip any candidate whose rounded yearly equals the base salary to avoid duplicate line
      if (k === baseKey) continue;

      const rep = rowsMap.get(k);
      if (!rep) continue;

      // determine which cell to snap/highlight (based on the representative candidate source)
      const snap =
        rep.source === "FT"
          ? "FT"
          : rep.source === "PT"
            ? "PT"
            : rep.source === "PCT"
              ? "PCT"
              : null;

      // Highlight rules (single-row based, no grouping):
      const highlightFull =
        Number.isFinite(rep.fullYearly) &&
        Math.abs(
          rep.fullYearly / this._cfg.INCREMENT_AMOUNT -
            Math.round(rep.fullYearly / this._cfg.INCREMENT_AMOUNT),
        ) < epsilon;

      const highlightPart =
        Number.isFinite(rep.partYearly) &&
        Math.abs(
          rep.partYearly / this._cfg.INCREMENT_AMOUNT -
            Math.round(rep.partYearly / this._cfg.INCREMENT_AMOUNT),
        ) < epsilon;

      const highlightPct =
        Number.isFinite(rep.raisePct) &&
        Math.abs(
          rep.raisePct / percentStepPct -
            Math.round(rep.raisePct / percentStepPct),
        ) < epsilon;

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
    // Columns: Yearly (full-time), Yearly (part-time), Yearly Δ, Monthly, Raise (%), Monthly Δ

    const fullVal = this._formatCurrency(candidate.fullYearly, currency);
    const partVal = this._formatCurrency(candidate.partYearly, currency);
    const yearlyDiffVal = this._formatCurrency(candidate.yearlyDiff, currency);
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
    const yearlyDiffCell = { text: yearlyDiffVal };

    // Append row (cells order matches header)
    // Use rounded fullYearly as a stable key (string)
    const key = String(Math.round(candidate.fullYearly || 0));
    this._addRow(
      [fullCell, partCell, monthlyVal, pctCell, yearlyDiffCell, diffCell],
      { key },
    );
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
    const { currency, fullTime, days, results } = this._els;

    // Existing render-on-input behavior
    [currency, fullTime, days].forEach((el) => {
      el.addEventListener("input", this._onInput);
      // When the form updates the URL (index.html's updateUrlFromForm), it may replace the query.
      // Re-apply our highlights param immediately after (allow other handlers to run first).
      el.addEventListener("input", () =>
        setTimeout(() => this._updateUrlWithHighlights(), 0),
      );
      el.addEventListener("change", () =>
        setTimeout(() => this._updateUrlWithHighlights(), 0),
      );
    });

    // Row click handling (event delegation)
    if (results) {
      results.addEventListener("click", this._onRowClick);
    }

    // Ensure the nav button exists (will be shown only when needed)
    this._ensureNavButtons();

    // Restore highlights from URL so initial render can reflect them
    this._restoreHighlightsFromUrl();
  }

  // Restore highlighted keys from the URL `highlights` parameter (comma separated)
  _restoreHighlightsFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      const highlights = params.get("highlights");
      if (!highlights) return;
      const parts = highlights
        .split(",")
        .map((p) => String(p).trim())
        .filter(Boolean);
      this._highlighted = new Set(parts);
    } catch (err) {
      // ignore malformed param
      this._highlighted = new Set();
    }
  }

  // Update the URL `highlights` parameter to reflect current highlighted set.
  // This merges with existing params instead of replacing them.
  _updateUrlWithHighlights() {
    try {
      const params = new URLSearchParams(location.search);

      if (this._highlighted.size > 0) {
        params.set("highlights", Array.from(this._highlighted).join(","));
      } else {
        params.delete("highlights");
      }

      const newQuery = params.toString();
      const newUrl = location.pathname + (newQuery ? "?" + newQuery : "");
      history.replaceState(null, "", newUrl);

      // show/hide reset button based on current highlights
      this._showOrHideResetButton();
    } catch (err) {
      // noop on any errors
    }
  }

  // Click handler (delegated) for table rows
  _onRowClick(ev) {
    // Only handle clicks inside tbody rows
    const tr = ev.target && ev.target.closest ? ev.target.closest("tr") : null;
    if (!tr || !this._els.results || !this._els.results.contains(tr)) return;

    const key = tr.dataset && tr.dataset.key ? String(tr.dataset.key) : null;
    if (!key) return;

    if (this._highlighted.has(key)) {
      this._highlighted.delete(key);
      tr.classList.remove("table-primary");
    } else {
      this._highlighted.add(key);
      tr.classList.add("table-primary");
    }

    // Update URL and reset button visibility
    this._updateUrlWithHighlights();
  }

  // Create or find the "Reset highlighted rows" button and wire its handler.
  // It will be inserted just before the existing #copyLink button if possible.
  _ensureNavButtons() {
    try {
      const copyBtn = document.getElementById("copyLink");
      if (!copyBtn) return;

      // If the reset button already exists, keep reference
      let resetBtn = document.getElementById("resetHighlights");
      if (!resetBtn) {
        resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.id = "resetHighlights";
        resetBtn.className = "btn btn-sm btn-outline-secondary me-2";
        resetBtn.textContent = "Reset highlighted rows";
        resetBtn.style.display = "none";
        resetBtn.addEventListener("click", () => this._onResetClick());
        // Insert before copyBtn in the same container if possible
        if (copyBtn.parentNode) {
          copyBtn.parentNode.insertBefore(resetBtn, copyBtn);
        } else {
          copyBtn.before(resetBtn);
        }
      }
      this._resetBtn = resetBtn;

      // Update visibility based on current highlighted set
      this._showOrHideResetButton();
    } catch (err) {
      // ignore
    }
  }

  _showOrHideResetButton() {
    if (!this._resetBtn) return;
    if (this._highlighted.size > 0) {
      this._resetBtn.style.display = "";
    } else {
      this._resetBtn.style.display = "none";
    }
  }

  _onResetClick() {
    // Clear highlights and update UI + URL
    this._highlighted.clear();

    // Remove class from all rendered rows
    const rows = this._els.results
      ? Array.from(this._els.results.querySelectorAll("tr"))
      : [];
    rows.forEach((r) => r.classList.remove("table-primary"));

    this._updateUrlWithHighlights();
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

    // If a key was provided, add it as a data attribute for selection
    if (opts.key) {
      tr.dataset.key = String(opts.key);
      // make rows show pointer to indicate clickability
      tr.style.cursor = "pointer";
    }

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

    // If this row corresponds to a highlighted key, mark it visually
    if (
      tr.dataset &&
      tr.dataset.key &&
      this._highlighted.has(String(tr.dataset.key))
    ) {
      tr.classList.add("table-primary");
    }

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
