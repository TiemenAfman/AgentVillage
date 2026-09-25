import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const g = await import('../web/js/goldpit.js');
const s = g.pileSlots();
const byY = {};
for (const x of s) { const k = Math.round(x[1] / g.BAR.h); byY[k] = (byY[k] || 0) + 1; }
const loose = s.filter((x, i) => x[1] === 0 && Math.abs(x[3]) > 0.5 || (x[1] === 0 && Math.abs(x[2]) > 0 && x[2] > 0.08)).length;
const corners = s.map(g.barCorners).flat();
console.log('bars', s.length, 'per course', byY, 'loose-ish', loose);
console.log('x', Math.min(...corners.map(c=>c[0])).toFixed(3), Math.max(...corners.map(c=>c[0])).toFixed(3), 'z', Math.min(...corners.map(c=>c[1])).toFixed(3), Math.max(...corners.map(c=>c[1])).toFixed(3));
const c = g.coinSlots();
console.log('coins', c.length, 'raised', c.filter(x => x[1] > 0 && x[1] < 0.1).length, 'counter', c.filter(x => x[1] > 0.3).length);
const lo = s.filter((x) => x[1] === 0 && (Math.abs(x[3]) > 0.11 || x[2] > 0.03 || Math.abs(x[0]) > 0.63));
console.log('loose', lo.length, lo.map((x) => x.map((v) => +v.toFixed(2)).join(',')).join(' | '));
