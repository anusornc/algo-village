import { chromium } from 'playwright';

const browser = await Promise.race([
  chromium.launch({ channel: 'msedge', headless: true, timeout: 25000 }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('LAUNCH TIMEOUT')), 30000)),
]);
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
const errors = [];
const benign = t => t.includes('setPointerCapture') || t.includes('404');
page.on('pageerror', e => { if (!benign(e.message)) errors.push(e.message); });
page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push(m.text()); });

await page.goto('http://localhost:8420/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => __algo.startMission(1));
await page.waitForTimeout(2600);

const PEGX = [-3.6, 0, 3.6];
const state = () => page.evaluate(() => {
  const g = __algo.game();
  return {
    pegs: JSON.parse(JSON.stringify(g.pegs)),
    y: g.discs.map(d => +d.wrapper.position.y.toFixed(2)),
    moves: g.moves,
    selected: g.selected ? g.selected.size : null,
  };
});
const waitIdle = () => page.waitForFunction(
  () => { const g = __algo.game(); return g && !g.busyAnim; },
  null, { timeout: 8000, polling: 100 }
);
// ใช้ synthetic PointerEvent ในหน้า (กายภาพของ headless กลืน click บางตัว)
const synthClick = (x, y) => page.evaluate(({x, y}) => {
  const cv = document.querySelector('#scene canvas');
  const o = { clientX: x, clientY: y, bubbles: true, pointerId: 99, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1 };
  cv.dispatchEvent(new PointerEvent('pointerdown', o));
  cv.dispatchEvent(new PointerEvent('pointerup', o));
}, { x, y });
const clickDisc = async (size) => {
  const p = await page.evaluate(size => {
    const g = __algo.game();
    const d = g.discs[size];
    return __algo.project({ x: d.wrapper.position.x, y: d.wrapper.position.y + .3, z: 0 });
  }, size);
  await synthClick(p.x, p.y);
  await page.waitForTimeout(300);
  await waitIdle();
};
const clickPeg = async (peg) => {
  const p = await page.evaluate(peg => __algo.project({ x: [-3.6, 0, 3.6][peg], y: .4, z: 0 }), peg);
  await synthClick(p.x, p.y);
  await page.waitForTimeout(300);
  await waitIdle();
};

const pass = (name, cond) => console.log((cond ? '✅' : '❌') + ' ' + name);

// เริ่มต้น: A=[3,2,1,0]
let s = await state();
pass('start A=[3,2,1,0]', JSON.stringify(s.pegs[0]) === '[3,2,1,0]');
pass('start visual largest-bottom (y3<y2<y1<y0)', s.y[3] < s.y[2] && s.y[2] < s.y[1] && s.y[1] < s.y[0]);

// กติกา: คลิกใบล่าง (ไม่ใช่บนสุด) ต้องถูกปัด
await clickDisc(3);
s = await state();
pass('bottom disc rejected', JSON.stringify(s.pegs[0]) === '[3,2,1,0]' && s.moves === 0);

// m1: disc0 A→B (เสาว่าง)
await clickDisc(0); await clickPeg(1);
s = await state();
pass('m1 disc0 A→B', JSON.stringify(s.pegs[1]) === '[0]' && s.moves === 1);

// m2: disc1 A→C (เสาว่าง)
await clickDisc(1); await clickPeg(2);
s = await state();
pass('m2 disc1 A→C', JSON.stringify(s.pegs[2]) === '[1]' && s.moves === 2);

// m3: disc0 B→C โดยคลิก "ที่ตัวถัง disc1 บนเสา C" (UX ใหม่: วางบนเสาของใบนั้น)
await clickDisc(0);
await page.evaluate(() => {}); // รอให้ยก
await clickDisc(1); // คลิกถังบนสุดของ C = วางลง C
s = await state();
pass('m3 disc0 B→C via clicking disc', JSON.stringify(s.pegs[2]) === '[1,0]' && s.moves === 3);

// ตอนนี้ A=[3,2] B=[] C=[1,0] — ทดสอบกติกาห้ามวางใบใหญ่บนใบเล็ก: disc2 ลง C (บน disc0) ต้องถูกปัด
await clickDisc(2); await clickPeg(2);
s = await state();
pass('illegal disc2→C(on 0) rejected', JSON.stringify(s.pegs[2]) === '[1,0]' && s.moves === 3);
// ยกเลิกการเลือกโดยคลิกถังเดิมซ้ำ (toggle off) — รอให้อนิเมชัน shake จบก่อน
await page.waitForTimeout(600);
const preToggle = await state();
console.log('   pre-toggle state:', JSON.stringify(preToggle));
const probePt = await page.evaluate(() => {
  const g = __algo.game();
  const d = g.discs[2];
  return __algo.project({ x: d.wrapper.position.x, y: d.wrapper.position.y + .3, z: 0 });
});
console.log('   toggle click @', Math.round(probePt.x), Math.round(probePt.y),
  '| probe:', JSON.stringify(await page.evaluate(({x,y}) => __algo.probe(x,y), probePt)));
await clickDisc(2);
s = await state();
console.log('   post-toggle state:', JSON.stringify(s));
pass('deselect via same disc', s.selected === null);

// สานต่อให้ถึงทางแยก: m4 disc2 A→B (ว่าง) แล้ว disc1 C→B บน disc2 (ถูกกติกา 1<2)
await clickDisc(2); await clickPeg(1);
console.log('   after m4:', JSON.stringify(await state()));
// m5: disc1 ยังโดน disc0 ครอบอยู่บน C → ต้องย้าย disc0 ไปพักบน A (บน disc3) ก่อน
await clickDisc(1); // คลิกใบใต้สุด (ไม่ใช่บนสุด) → ต้องถูกปัดตามกฎ Stack
let midState = await state();
pass('non-top disc1 click rejected', JSON.stringify(midState.pegs[2]) === '[1,0]' && midState.moves === 4 && midState.selected === null);
await clickDisc(0); await clickPeg(0); // disc0 C→A วางบน disc3 (0<3 ถูกกติกา)
await clickDisc(1); await clickPeg(1); // disc1 C→B วางบน disc2 (1<2 ถูกกติกา)
s = await state();
s = await state();
pass('m4+m5 disc2→B, disc1→B on disc2', JSON.stringify(s.pegs[1]) === '[2,1]' && s.moves === 6);
await page.screenshot({ path: '/tmp/pwtest/shots/12-hanoi-mid.png', timeout: 12000 }).catch(()=>{});

// ---------- เฉลย (demo): รีเซ็ตแล้วรัน recursive 15 ก้าว ----------
await page.click('#hgDemo');
await page.waitForTimeout(30000); // reset + 15 ก้าว
s = await state();
pass('demo final pegs C=[3,2,1,0]', JSON.stringify(s.pegs[2]) === '[3,2,1,0]');
pass('demo final visual largest-bottom on C', s.y[3] < s.y[2] && s.y[2] < s.y[1] && s.y[1] < s.y[0]);
await page.screenshot({ path: '/tmp/pwtest/shots/13-hanoi-demo-final.png', timeout: 12000 }).catch(()=>{});

console.log('---- ERRORS ----');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();
process.exit(errors.length ? 1 : 0);
