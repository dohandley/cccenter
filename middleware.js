// Site password for CC Center.
// Public (no password): the Sim Ledger page and its data, the logo, and the login page.
// Everything else (dashboard, SimpleOdds, HR Highlights, the picks logs) needs the password.
// The password lives only in the Vercel environment variable CC_PASSWORD, never in this repo.
import { next } from '@vercel/functions';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = { matcher: '/:path*' };

const PUBLIC = [/^\/sim(\.html)?$/, /^\/sim\//, /^\/logo\.png$/, /^\/favicon\.ico$/, /^\/login(\.html)?$/, /^\/robots\.txt$/];
const COOKIE = 'cc_auth';
const MAX_AGE = 60 * 60 * 24 * 180; // stay signed in for 180 days per device

const token = pw => createHmac('sha256', pw).update('cc-center-auth-v1').digest('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const cookie = (req, name) => {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
};
const safeNext = n => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');
const redirect = (to, cookies = []) => {
  const h = new Headers({ Location: to, 'Cache-Control': 'no-store' });
  cookies.forEach(c => h.append('Set-Cookie', c));
  return new Response(null, { status: 303, headers: h });
};

export default async function middleware(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const pw = process.env.CC_PASSWORD || '';

  if (path === '/logout') {
    return redirect('/login', [`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, 'cc_in=; Path=/; Max-Age=0; Secure; SameSite=Lax']);
  }

  if (path === '/login' && req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    const given = String((form && form.get('password')) || '');
    const to = safeNext(String((form && form.get('next')) || '/'));
    if (pw && given && same(given, pw)) {
      return redirect(to, [
        `${COOKIE}=${token(pw)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        `cc_in=1; Path=/; Max-Age=${MAX_AGE}; Secure; SameSite=Lax`, // lets pages show the owner's nav; grants nothing
      ]);
    }
    return redirect(`/login?e=1&next=${encodeURIComponent(to)}`);
  }

  if (PUBLIC.some(r => r.test(path))) return next();

  if (pw && same(cookie(req, COOKIE), token(pw))) return next();

  return redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
}
