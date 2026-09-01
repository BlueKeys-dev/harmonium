import { demoScoreText } from "../score";

const DEMO_JSON = demoScoreText();

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column; gap: 12px;
    padding: 24px; background: #07070a; color: #e8e8ec;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { font-size: 1rem; letter-spacing: .14em; text-transform: uppercase; margin: 0; color: #8b8b96; }
  textarea {
    flex: 1; width: 100%; resize: none; background: #121218; color: #e8e8ec;
    border: 1px solid #26262e; border-radius: 8px; padding: 12px 14px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .82rem; line-height: 1.55;
  }
  textarea:focus { outline: none; border-color: rgba(255,90,31,.55); }
  .row { display: flex; gap: 8px; align-items: center; }
  button {
    border: 1px solid #26262e; background: #121218; color: #e8e8ec;
    border-radius: 999px; padding: 8px 16px; font-size: .85rem; cursor: pointer; font-family: inherit;
  }
  button:hover { border-color: rgba(255,90,31,.55); }
  button.primary { border-color: #ff5a1f; color: #ff5a1f; }
  .err { color: #ff6b6b; font-size: .82rem; min-height: 1.2em; }
  .hint { color: #8b8b96; font-size: .74rem; margin: 0; }
`;

function script(): string {
  return `
    var ta = document.getElementById("ta");
    var err = document.getElementById("err");
    var demo = document.getElementById("demo");
    var apply = document.getElementById("apply");
    var DEMO = ${DEMO_JSON};

    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;
      var d = e.data || {};
      if (d.type === "harmonium-score-init" && typeof d.text === "string") {
        ta.value = d.text;
      }
    });
    if (window.opener) {
      window.opener.postMessage({ type: "harmonium-score-request-init" }, location.origin);
    }

    demo.addEventListener("click", function () {
      ta.value = DEMO;
      err.textContent = "";
    });

    apply.addEventListener("click", function () {
      var parsed;
      try {
        parsed = JSON.parse(ta.value);
      } catch (e) {
        err.textContent = "Invalid JSON: " + e.message;
        return;
      }
      if (!parsed || !Array.isArray(parsed.events) || parsed.events.length === 0) {
        err.textContent = "events must be a non-empty array of { t, key, dur }";
        return;
      }
      if (parsed.sa !== undefined && parsed.sa !== null) {
        var SA = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
        if (SA.indexOf(String(parsed.sa).trim().toUpperCase()) < 0) {
          err.textContent = "sa must be one of " + SA.join(", ");
          return;
        }
      }
      var badEvent = parsed.events.some(function (ev) {
        return !ev || typeof ev.t !== "number" || !(ev.t >= 0) ||
          !Number.isInteger(ev.key) || ev.key < 0 || ev.key > 38;
      });
      if (badEvent) {
        err.textContent = "each event needs t >= 0 and integer key 0-38";
        return;
      }
      err.textContent = "";
      if (window.opener) {
        window.opener.postMessage({ type: "harmonium-score", text: ta.value }, location.origin);
      }
      apply.textContent = "Applied";
      setTimeout(function () { apply.textContent = "Apply to harmonium"; }, 1200);
    });

    ta.addEventListener("input", function () { err.textContent = ""; });
  `;
}

/**
 * Opens a simplified standalone JSON editor tab (same-origin about:blank).
 * It pulls the current score from the opener and posts edits back with
 * postMessage; the harmonium page validates before loading them.
 */
export function openJsonEditor(): Window | null {
  const win = window.open("", "harmonium-score-editor");
  if (!win) return null;
  win.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>web-harmonium · score JSON</title><style>${STYLE}</style></head><body><h1>Score JSON</h1><textarea id="ta" spellcheck="false"></textarea><div class="err" id="err"></div><div class="row"><button id="demo">Load demo</button><button id="apply" class="primary">Apply to harmonium</button></div><p class="hint">t / dur = seconds · key 0–38 sets pitch (key 12 = C4) · note is an advisory Sargam label · sa: C…B · overlapping events are chords</p><script>${script()}<\/script></body></html>`,
  );
  win.document.close();
  return win;
}
