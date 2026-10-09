// Local-only visual regression helper. Not part of the app.
import { chromium } from 'playwright';

const base = process.env.APP_URL || 'http://localhost:5173';
const email = process.env.QA_EMAIL;
const password = process.env.QA_PASSWORD;
const sizes = [360, 768, 1280];
const routes = (process.env.ROUTES || '/dashboard,/students,/teachers').split(',');

const probe = () => {
  const d = document;
  const vw = window.innerWidth;
  const issues = [];
  const scrollAncestor = (el) => {
    let p = el.parentElement;
    while (p && p !== d.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };
  d.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (getComputedStyle(el).visibility === 'hidden') return;
    const inDrawer = el.closest('.MuiDrawer-root') && !el.closest('.MuiDrawer-docked');
    if (inDrawer && !el.closest('.MuiModal-root')) return;
    const name = el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? (el.className.split(' ')[1] || el.className.split(' ')[0] || '') : '');
    if (!scrollAncestor(el) && (r.right > vw + 1 || r.left < -1)) issues.push('CLIP ' + name + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
    else if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0) {
      const cs = getComputedStyle(el);
      const intentionalEllipsis = cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap';
      if (cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && !intentionalEllipsis) {
        issues.push('OVF ' + name + ' ' + el.scrollWidth + '>' + el.clientWidth);
      }
    }
  });
  // crude overlap check between header children
  const bar = d.querySelector('.MuiAppBar-root .MuiToolbar-root');
  const overlaps = [];
  if (bar) {
    const kids = [...bar.children].filter((c) => c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== 'none');
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) {
          overlaps.push(kids[i].tagName + ' x ' + kids[j].tagName);
        }
      }
    }
  }
  return {
    docScroll: d.documentElement.scrollWidth,
    client: d.documentElement.clientWidth,
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    overlaps,
    issues: [...new Set(issues)].slice(0, 12),
  };
};

const ready = () => {
  const d = document;
  return (
    !d.querySelector('.MuiCircularProgress-root') &&
    d.body &&
    d.body.innerText.replace(/\s+/g, ' ').trim().length > 300
  );
};

const signIn = async (page) => {
  await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
  if (!email || !password) return;
  await page.getByLabel('Email Address').waitFor({ timeout: 20000 });
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in|login/i }).click();
  await page.waitForURL(base + '/', { timeout: 15000 }).catch(() => {});
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: sizes[0], height: 800 } });
const page = await context.newPage();
await signIn(page);
const signedIn = await page.evaluate(() => Boolean(localStorage.getItem('accessToken')));

for (const width of sizes) {
  await page.setViewportSize({ width, height: 800 });
  console.log(`\n=== ${width}px  signedIn=${signedIn} ===`);
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: 'domcontentloaded' }).catch(() => {});
    // Lazy route chunks + the Supabase round-trip can take several seconds in dev;
    // screenshot only once the page has actually rendered its content.
    await page.waitForFunction(ready, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const res = await page.evaluate(probe);
    const rendered = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().length);
    await page.screenshot({ path: `/tmp/responsive/${route.replace(/\//g, '_') || 'root'}-${width}.png` });
    console.log(route, `chars=${rendered}`, JSON.stringify(res));
  }
}
await browser.close();
