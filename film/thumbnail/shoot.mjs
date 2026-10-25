// Screenshots thumbnail.html at Devpost's 3:2 and YouTube's 16:9.
import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [name, w, h] of [['thumbnail', 1500, 1000], ['thumbnail-youtube', 1280, 720]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.goto(new URL('thumbnail.html', import.meta.url).href);
  await p.evaluate(([W, H]) => { document.body.style.setProperty('--w', `${W}px`); document.body.style.setProperty('--h', `${H}px`); }, [w, h]);
  await p.waitForTimeout(600);
  await p.screenshot({ path: new URL(`../../docs/${name}.jpg`, import.meta.url).pathname, type: 'jpeg', quality: 90 });
  console.log('shot', name);
}
await b.close();
