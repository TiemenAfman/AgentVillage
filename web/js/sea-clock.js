// The host's hand on the world's clock (Plans/zeetijd-van-de-host.md): a few hours to jump
// the sea to, and the real time. Nobody else gets this - the clock chip is the sea's time
// and a click on it does nothing for a player who did not raise this sea - and nothing here
// changes this screen alone: a pick goes to the islander (POST /api/sea-time), the islander
// to the sea it runs, and the sea tells every page, this one included, with `{t:'clock'}`.
import { openPopover, closePopover } from './popover.js';

// Hours worth jumping to: the dawn, the morning coffee, noon, the Friday borrel's afternoon,
// dusk and the dark. Not the whole dial - a host wanting 03:17 is a developer with `?hour`.
export const SEA_HOURS = [
  { hour: 6, label: '06:00 · Dawn' },
  { hour: 9, label: '09:00 · Morning' },
  { hour: 12, label: '12:00 · Noon' },
  { hour: 16.5, label: '16:30 · Afternoon' },
  { hour: 19.5, label: '19:30 · Dusk' },
  { hour: 23, label: '23:00 · Night' },
];

// `pick` gets `{ hour }` or `{ real: true }` and returns a promise; the popover closes on the
// pick and the chip catches up when the sea's broadcast arrives.
export function openSeaClock({ anchor, shifted, pick }) {
  const box = document.createElement('div');
  box.className = 'sea-clock';
  const head = document.createElement('p');
  head.textContent = 'Set the sea’s clock for everybody on it';
  box.append(head);
  const button = (text, want, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sea-clock-btn ${cls}`.trim();
    b.textContent = text;
    b.addEventListener('click', () => { closePopover(); pick(want); });
    box.append(b);
    return b;
  };
  for (const h of SEA_HOURS) button(h.label, { hour: h.hour });
  const real = button('Real time', { real: true }, 'real');
  real.disabled = !shifted;
  const pop = openPopover({ anchor, content: box, side: 'bottom', className: 'sea-clock-pop' });
  const first = box.querySelector('button:not([disabled])');
  if (first) first.focus({ preventScroll: true });
  return pop;
}
