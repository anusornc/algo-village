// ตัวรัน test-hanoi แบบมี launch-retry กันอาการ Edge automation ค้าง
import { spawn } from 'node:child_process';

const maxTries = 3;
for (let i = 1; i <= maxTries; i++) {
  console.log(`--- attempt ${i} ---`);
  const code = await new Promise(resolve => {
    const p = spawn('node', ['test-hanoi.mjs'], { cwd: '/tmp/pwtest', stdio: 'inherit' });
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve(-1); }, 150000);
    p.on('exit', c => { clearTimeout(timer); resolve(c ?? -1); });
  });
  if (code === 0) { console.log('SUCCESS'); process.exit(0); }
  console.log(`attempt ${i} failed (exit ${code}) — คราวนี้ทำความสะอาดโปรเซส automation ที่ค้าง`);
  const { execSync } = await import('node:child_process');
  try {
    const out = execSync(`ps aux | grep -i edge | grep -iE "remote-debugging|headless|playwright" | grep -v grep | awk '{print $2}'`).toString().trim();
    if (out) execSync(`kill ${out.split('\n').join(' ')} 2>/dev/null`);
  } catch {}
  await new Promise(r => setTimeout(r, 2000));
}
console.log('ALL ATTEMPTS FAILED');
process.exit(1);
