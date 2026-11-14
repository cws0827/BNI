// 把 explainer.html 逐格擷取成 1080×1920 MP4。
// 用法：node video/render.js [輸出檔，預設 video/explainer.mp4] [--fps 30] [--from 秒 --to 秒]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = args[0] && !args[0].startsWith('--') ? args[0] : path.join(__dirname, 'explainer.mp4');
const FPS = +opt('--fps', 30);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + path.join(__dirname, 'explainer.html'), { waitUntil: 'networkidle' });
  const DUR = await page.evaluate(() => window.DURATION);
  const from = +opt('--from', 0), to = +opt('--to', DUR);
  // 先把每個時間點跑過一次，讓網頁字型把所有用到的字都載進來
  for (let t = 0; t <= DUR; t += 0.5) await page.evaluate(t => render(t), t);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });

  const frames = Math.round((to - from) * FPS);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => render(t), from + f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % (FPS * 10) === 0) console.log(`  ${(from + f / FPS).toFixed(0)}s / ${to}s（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  if (errors.length) console.log('頁面錯誤：', errors);
  console.log('完成：' + OUT);
})();
