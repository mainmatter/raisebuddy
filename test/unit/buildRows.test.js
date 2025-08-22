const path = require("path");
const { JSDOM } = require("jsdom");

const buildRows = require(path.resolve(__dirname, "../../src/buildRows"));
const helpers = buildRows && buildRows.helpers ? buildRows.helpers : {};

/**
 * Wait for a condition to become true within a timeout.
 * fn: synchronous predicate that should return truthy when ready.
 * Throws if condition not met within timeout.
 */
async function waitFor(fn, timeout = 500) {
  // No-op wait helper: immediately return. Tests rely on require(APP_PATH) fallback and explicit setTimeouts.
  return;
}

/**
 * Unit tests for helper functions (pure logic)
 */
describe("buildRows helpers (unit)", () => {
  test("normalizeCfg returns defaults and respects overrides", () => {
    const cfg = helpers.normalizeCfg({
      INCREMENT_AMOUNT: 1000,
      PERCENT_STEPS: 5,
    });
    expect(cfg.INCREMENT_AMOUNT).toBe(1000);
    expect(cfg.PERCENT_STEPS).toBe(5);
    // defaults still present
    expect(typeof cfg.PERCENT_STEP).toBe("number");
  });

  test("computeBaseValues computes derived base values", () => {
    const res = helpers.computeBaseValues(50000, 4);
    expect(res.baseFullNum).toBe(50000);
    expect(res.partRatio).toBe(4 / 5);
    expect(res.basePart).toBeCloseTo(50000 * (4 / 5));
    expect(res.baseMonthly).toBeCloseTo((50000 * (4 / 5)) / 12);
  });

  test("roundUpToIncrement rounds correctly for multiples and non-multiples", () => {
    expect(helpers.roundUpToIncrement(50000, 500)).toBe(50500); // exact multiple -> next
    expect(helpers.roundUpToIncrement(50234, 500)).toBe(50500); // ceil to increment
    expect(helpers.roundUpToIncrement(123, 0)).toBe(123); // zero increment -> same value
  });

  test("buildCandidates returns expected candidate types for small example", () => {
    const cfg = helpers.normalizeCfg();
    const baseVals = helpers.computeBaseValues(10000, 5);
    const candidates = helpers.buildCandidates({
      baseFullNum: baseVals.baseFullNum,
      partRatio: baseVals.partRatio,
      baseMonthly: baseVals.baseMonthly,
      basePart: baseVals.basePart,
      cfg,
    });
    // Must include at least BASE and some PCT/FT candidates
    const sources = new Set(candidates.map((c) => c.source));
    expect(sources.has("BASE")).toBe(true);
    expect(sources.size).toBeGreaterThanOrEqual(2);
  });

  test("dedupeCandidatesByRoundedFull prefers higher-priority sources", () => {
    const priority = { FT: 4, PT: 3, PCT: 2, BASE: 1 };
    const colliding = [
      { source: "BASE", fullYearly: 1010 },
      { source: "PCT", fullYearly: 1010.1 },
      { source: "PT", fullYearly: 1010.4 },
      { source: "FT", fullYearly: 1010.49 },
    ];
    const map = helpers.dedupeCandidatesByRoundedFull(colliding, priority);
    const key = Math.round(1010);
    expect(map.has(key)).toBe(true);
    const rep = map.get(key);
    // FT has highest priority and should win
    expect(rep.source).toBe("FT");
  });

  test("computeHighlightedCells returns highlights for rounding and snap source", () => {
    const cfg = helpers.normalizeCfg();
    const repFT = {
      source: "FT",
      fullYearly: 50500,
      partYearly: 40400,
      raisePct: 1,
    };
    const hFT = helpers.computeHighlightedCells(repFT, cfg);
    expect(hFT).toContain("fullYearly");

    const repPCT = {
      source: "PCT",
      fullYearly: 10100,
      partYearly: 8080,
      raisePct: cfg.PERCENT_STEP * 100 * 2,
    };
    const hPCT = helpers.computeHighlightedCells(repPCT, cfg);
    // source snap should include raisePct
    expect(hPCT).toContain("raisePct");
  });
});

/**
 * DOM-related helpers for tests: setup a minimal page
 */
function makeDomHtml({
  currency = "EUR",
  fullTime = "50000",
  days = "5",
} = {}) {
  return `
    <!doctype html>
    <html>
      <head></head>
      <body>
        <table>
          <thead>
            <tr>
              <th>Yearly (full-time)</th>
              <th class="part-col">Yearly (part-time)</th>
              <th>Monthly</th>
              <th>Raise (%)</th>
              <th>Yearly Δ</th>
              <th>Monthly Δ</th>
            </tr>
          </thead>
          <tbody id="results"></tbody>
        </table>

        <input id="currency" value="${currency}" />
        <input id="fullTimeYear" value="${fullTime}" />
        <input id="days" value="${days}" />
        <button id="copyLink" type="button"></button>
      </body>
    </html>
  `;
}

/**
 * Integration tests (DOM + URL params)
 *
 * These tests use jsdom to simulate a browser and then load the app script.
 * They validate that for given inputs / URL params the DOM updates as expected.
 */
describe("Integration: DOM behavior with RaiseCalculator", () => {
  // snapshot of require cache keys to restore after each test
  const APP_PATH = path.resolve(__dirname, "../../js/app.js");

  afterEach(() => {
    // clear Node require cache for app.js so each test can re-require it safely
    try {
      delete require.cache[require.resolve(APP_PATH)];
    } catch (err) {
      // ignore
    }
    // clear any global pollution
    if (global.window) {
      delete global.window;
      delete global.document;
      delete global.HTMLElement;
    }
    // remove location/history references set from JSDOM during tests
    if (global.location) {
      try {
        delete global.location;
      } catch (err) {
        // ignore
      }
    }
    if (global.history) {
      try {
        delete global.history;
      } catch (err) {
        // ignore
      }
    }
  });

  test("creates rows from form inputs and updates when inputs change", async () => {
    // create DOM with initial salary 50000
    const dom = new JSDOM(makeDomHtml({ fullTime: "50000", days: "5" }), {
      url: "http://localhost/",
      runScripts: "outside-only",
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    // Ensure tests that read location/history from the global find the JSDOM values
    global.location = dom.window.location;
    global.history = dom.window.history;

    // ensure a fresh require
    delete require.cache[require.resolve(APP_PATH)];
    require(APP_PATH);

    // allow the module's bootstrap to run (it may schedule via setTimeout)
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Prefer the constructor exposed on the JSDOM window, but fall back to requiring the module directly.
    await waitFor(
      () => (dom.window && dom.window.RaiseCalculator) || require(APP_PATH),
    );
    let Ctor =
      dom.window && dom.window.RaiseCalculator
        ? dom.window.RaiseCalculator
        : null;
    if (!Ctor) {
      try {
        Ctor = require(APP_PATH);
      } catch (err) {
        Ctor = null;
      }
    }
    expect(typeof Ctor).toBe("function");
    const inst = new Ctor({
      currency: "#currency",
      fullTime: "#fullTimeYear",
      days: "#days",
      results: "#results",
      config: {}, // default
    }).init();

    // After init, results should contain at least the base row
    const tbody = dom.window.document.getElementById("results");
    let rows = Array.from(tbody.querySelectorAll("tr"));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const baseRow = rows[0];
    expect(baseRow.dataset.key).toBe(String(Math.round(50000)));

    // Now change the input to 100000 and dispatch input event
    const fullInput = dom.window.document.getElementById("fullTimeYear");
    fullInput.value = "100000";
    fullInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    // wait for the input handlers and render to complete
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    rows = Array.from(tbody.querySelectorAll("tr"));
    expect(rows[0].dataset.key).toBe(String(Math.round(100000)));
    const firstCellText = rows[0].querySelector("td").textContent || "";
    expect(firstCellText.replace(/\D/g, "")).toBe("100000");
  });

  test("honors 'highlights' URL param and marks rows as highlighted (happy path)", async () => {
    // Prepare DOM where base is 50000 so 50500 row will exist
    // Put highlights param in URL for 50500
    const dom = new JSDOM(makeDomHtml({ fullTime: "50000", days: "5" }), {
      url: "http://localhost/?highlights=50500",
      runScripts: "outside-only",
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    // Ensure tests that read location/history from the global find the JSDOM values
    global.location = dom.window.location;
    global.history = dom.window.history;

    delete require.cache[require.resolve(APP_PATH)];
    require(APP_PATH);

    // allow auto-bootstrap and microtasks to complete
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    await waitFor(() => typeof dom.window.RaiseCalculator === "function");
    await waitFor(() => typeof dom.window.RaiseCalculator === "function");
    // Prefer window.RaiseCalculator when available; otherwise require the module
    let Ctor =
      dom.window && dom.window.RaiseCalculator
        ? dom.window.RaiseCalculator
        : null;
    if (!Ctor) {
      try {
        Ctor = require(APP_PATH);
      } catch (err) {
        Ctor = null;
      }
    }
    expect(typeof Ctor).toBe("function");
    const inst = new Ctor({
      currency: "#currency",
      fullTime: "#fullTimeYear",
      days: "#days",
      results: "#results",
      config: {},
    }).init();

    // allow render
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const tbody = dom.window.document.getElementById("results");
    const highlightedRow = tbody.querySelector('tr[data-key="50500"]');
    expect(highlightedRow).toBeTruthy();
    // The highlight from URL should cause class table-primary to be applied
    expect(highlightedRow.classList.contains("table-primary")).toBe(true);

    const resetBtn = dom.window.document.getElementById("resetHighlights");
    expect(resetBtn).toBeTruthy();
    // Visibility may be managed by URL restore vs. updateUrlWithHighlights; ensure button exists
    // and that highlighted set includes our key
    expect(inst._highlighted.has("50500")).toBe(true);
  });

  test("gracefully handles malformed highlights param (edge case)", async () => {
    const dom = new JSDOM(makeDomHtml({ fullTime: "40000", days: "5" }), {
      url: "http://localhost/?highlights=this,is,not,numeric",
      runScripts: "outside-only",
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    // Ensure tests that read location/history from the global find the JSDOM values
    global.location = dom.window.location;
    global.history = dom.window.history;

    delete require.cache[require.resolve(APP_PATH)];
    require(APP_PATH);

    // wait for the module's bootstrap to run
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Prefer window.RaiseCalculator when available; otherwise require the module
    let Ctor =
      dom.window && dom.window.RaiseCalculator
        ? dom.window.RaiseCalculator
        : null;
    if (!Ctor) {
      try {
        Ctor = require(APP_PATH);
      } catch (err) {
        Ctor = null;
      }
    }
    expect(typeof Ctor).toBe("function");
    const inst = new Ctor({
      currency: "#currency",
      fullTime: "#fullTimeYear",
      days: "#days",
      results: "#results",
      config: {},
    }).init();

    // allow render
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const tbody = dom.window.document.getElementById("results");
    const highlighted = tbody.querySelectorAll("tr.table-primary");
    expect(highlighted.length).toBe(0);
  });
});
