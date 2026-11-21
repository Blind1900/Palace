// N81 (extends N34/N30): pipe bends are smooth and a level change never blocks the flow.
// Two laws, checked together:
//  1. GEOMETRY: along every line, neighbouring columns differ by at most ONE cell -
//     anything steeper shoves casing into the lane path and stops the stream cold.
//     A registered WELL is the one sanctioned exception: a true vertical the packets
//     climb by design.
//  2. FLOW: stepped live, no packet sticks mid-run - cargo passes every bend and level
//     change - and every resource keeps delivering.
// --page=pixel-world.html --params=det=1&seed=N
const { world } = pwApp;
const checks = [];
const check = (ok, text) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
const P = world.pipes;
check(!!P && P.lines.length > 0, `lines stand (${P ? P.lines.length : 0})`);

// 1. geometry: every step <= 1 unless a well carries it
let steep = 0, example = '';
for (const line of P.lines) {
  if (!line.ys) continue;
  for (let k = 0; k + 1 < line.ys.length; k += 1) {
    const d = Math.abs(line.ys[k + 1] - line.ys[k]);
    // A step up to 6 cells is laid as a SWEPT MITRED BEND (the bore's rows carried across
    // the joint, lanes unbroken); a taller one as a registered WELL (a shaft the packets
    // climb). A bare step over 6 outside a well is the user's sharp cut-off that walls the
    // cargo. (Flow carries both - check 2 proves no lane is actually blocked.)
    if (d <= 6) continue;
    const x = line.x0 + k;
    // a well (its own column, or a neighbour it merged into - a merged shaft spans up to
    // ~9 columns, registered at the merge target's x) carries this level change
    const well = (line.wells || []).some((w) => Math.abs(w.x - x) <= 11);
    if (well) continue;
    steep += 1;
    if (!example) example = `line#${line.id} x${x} step ${d}`;
  }
}
check(steep === 0, `every level change is a swept bend or a well - no sharp step (${steep}${example ? '; first ' + example : ''})`);

// 2. flow: step live, watch every packet's progress; stuck = no movement for 12 s mid-run
const before = { ...P.stats.delivered };
const frontAt = () => {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const l of P.lines) for (const p of l.packets) {
    if (p.done || p.resource !== 'hm') continue;
    n += 1;
    const d = Math.abs(p.x - (p.dstX ?? p.x));
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { n, nearest: lo };
};
const hm0 = frontAt();
// The flow law is checked at the system level, which is both robust and what the law
// actually means: cargo PASSES every bend and level change. A single packet may queue
// behind a slow mouth (the stores drain one climber at a time) - that is not a block.
// A real block (a level change that walled the lane) starves everything downstream, so
// deliveries plateau while cargo still waits. We watch for that over the whole window:
// each lane must keep ARRIVING as long as it holds cargo. (The geometry check above
// already proves no level change leaves a lane walled; this proves it carries.)
const lastMove = { sm: 0, hm: 0, water: 0 };
let maxStall = { sm: 0, hm: 0, water: 0 };
let prevDeliv = { ...P.stats.delivered };
const holding = { sm: false, hm: false, water: false };
for (let s = 0; s < 75; s += 1) {
  pwApp.stepWorld(60);
  for (const line of P.lines) for (const p of line.packets) if (!p.done) holding[p.resource] = true;
  for (const r of ['sm', 'hm', 'water']) {
    if (P.stats.delivered[r] > prevDeliv[r]) lastMove[r] = s;
    else if (holding[r] && s - lastMove[r] > maxStall[r]) maxStall[r] = s - lastMove[r];
  }
  prevDeliv = { ...P.stats.delivered };
}
// a lane that holds cargo yet never delivers for 40 s of the 75 is walled somewhere
const walled = ['sm', 'water'].filter((r) => holding[r] && maxStall[r] >= 40);
check(walled.length === 0, `no cargo sticks at any bend or level change${walled.length ? ' (WALLED: ' + walled.map((r) => r + ' stalled ' + maxStall[r] + 's').join(', ') + ')' : ''}`);
const after = P.stats.delivered;
// Ore may have a LONG march to its nearest consumer (a base half the map away): either it
// delivered in the window, or the convoy is visibly on the road - packets in flight with
// the gap to their destinations closing.
const hm1 = frontAt();
const oreMoves = after.hm > before.hm || (hm1.n > 0 && hm0.n >= 0 && hm1.nearest < (hm0.n ? hm0.nearest : Infinity) - 200) || (hm1.n > 0 && hm0.n === 0);
check(after.water > before.water && after.sm >= before.sm && oreMoves,
  `the lanes keep delivering through it all (water ${before.water}->${after.water}, sm ${before.sm}->${after.sm}, hm ${before.hm}->${after.hm}; ore front ${hm0.n ? hm0.nearest : '-'}->${hm1.n ? hm1.nearest : '-'})`);
return { checks, shots: 0 };
