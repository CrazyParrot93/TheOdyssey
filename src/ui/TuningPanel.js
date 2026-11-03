import { G } from '../core/context.js';
import { COMBAT, Tuning, RANGES } from '../core/Tuning.js';

// F6: live combat tuning panel. Changes apply immediately and persist; three preset slots.
export class TuningPanel {
  constructor() {
    this.el = null;
    G.bus.on('keydown', (code) => { if (code === 'F6') this.toggle(); });
  }
  toggle() {
    if (this.el) { this.el.remove(); this.el = null; return; }
    G.input.unlockPointer();
    const el = document.createElement('div');
    el.id = 'debug-menu';
    el.style.width = '330px';
    el.style.left = '8px'; el.style.right = 'auto';
    const rows = Object.keys(RANGES).map((k) => {
      const [mn, mx, st] = RANGES[k];
      return `<label title="${k}"><span style="flex:1">${k}</span><input type="range" data-k="${k}" min="${mn}" max="${mx}" step="${st}" value="${COMBAT[k]}" style="width:110px"><b data-v="${k}" style="width:48px;text-align:right">${COMBAT[k]}</b></label>`;
    }).join('');
    el.innerHTML = `<h4>Combat tuning (F6)</h4>${rows}
      <h4>Presets</h4>
      <div style="display:flex;gap:4px">${[1, 2, 3].map((n) => `<button data-save="${n}">Save ${n}</button><button data-load="${n}">Load ${n}</button>`).join('')}</div>
      <button data-a="export">Copy JSON to clipboard</button><button data-a="import">Import JSON…</button><button data-a="reset">Reset to defaults</button>
      <div data-msg style="color:#9f9;margin-top:4px"></div>`;
    const msg = (t) => { el.querySelector('[data-msg]').textContent = t; };
    const refresh = () => el.querySelectorAll('input[data-k]').forEach((i) => { i.value = COMBAT[i.dataset.k]; el.querySelector(`[data-v="${i.dataset.k}"]`).textContent = COMBAT[i.dataset.k]; });
    el.addEventListener('input', (e) => {
      const k = e.target.dataset.k; if (!k) return;
      COMBAT[k] = parseFloat(e.target.value);
      el.querySelector(`[data-v="${k}"]`).textContent = COMBAT[k];
      Tuning.persist();
    });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.save) { Tuning.saveSlot(b.dataset.save); msg(`Saved preset ${b.dataset.save}`); }
      if (b.dataset.load) { msg(Tuning.loadSlot(b.dataset.load) ? `Loaded preset ${b.dataset.load}` : 'Empty slot'); refresh(); }
      if (b.dataset.a === 'reset') { Tuning.reset(); refresh(); msg('Defaults restored'); }
      if (b.dataset.a === 'export') { try { await navigator.clipboard.writeText(Tuning.export()); msg('Copied'); } catch (err) { console.log(Tuning.export()); msg('Clipboard blocked: JSON printed to console'); } }
      if (b.dataset.a === 'import') { const j = prompt('Paste tuning JSON'); if (j) { try { Tuning.import(j); refresh(); msg('Imported'); } catch (err) { msg('Invalid JSON'); } } }
    });
    document.body.appendChild(el);
    this.el = el;
  }
}
