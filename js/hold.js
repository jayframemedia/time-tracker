// Press and hold FINISH for one second. Releasing early cancels.
import { $ } from './ui.js';
import { state, tick } from './state.js';
import { onFinish } from './actions.js';

const HOLD_MS = 1000;
let holdRaf = 0;
let holdStart = 0;

/** True while FINISH is being held (nothing should re-render or reload then). */
export const isHolding = () => holdRaf !== 0;

function holdFrame() {
  state.hold = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
  tick();
  if (state.hold >= 1) { holdRaf = 0; onFinish(); return; }
  holdRaf = requestAnimationFrame(holdFrame);
}

export function beginHold(ev) {
  if (ev.button > 0 || state.busy) return; // primary button / touch only
  ev.preventDefault();
  holdStart = performance.now();
  cancelAnimationFrame(holdRaf);
  $('#finish')?.classList.add('holding');
  holdRaf = requestAnimationFrame(holdFrame);
}

export function cancelHold(redraw = true) {
  if (holdRaf) cancelAnimationFrame(holdRaf);
  holdRaf = 0;
  state.hold = 0;
  $('#finish')?.classList.remove('holding');
  if (redraw) tick();
}
