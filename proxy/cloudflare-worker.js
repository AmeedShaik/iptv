// Cloudflare Worker: a tiny CORS proxy for IPTV streams.
// Usage:  https://YOUR-WORKER.workers.dev/?url=<encoded stream or playlist URL>
//
// 1) Change ALLOWED_ORIGINS below to the address of YOUR web page (origin only, no path).
// 2) Paste this whole file into a new Cloudflare Worker and deploy it.

const ALLOWED_ORIGINS = [
  'https://ameedshaik.github.io', // your GitHub Pages site
  'http://localhost:8000',        // local testing (optional)
  'http://127.0.0.1:8000',
];

// Never fetch private / local addresses.
const BLOCKED_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i;

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    // Browsers always send Origin on cross-origin requests; requests without one (e.g. typed into the
    // address bar for testing) are allowed.
    if (origin && ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }

    const cors = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get('url'));
    } catch {
      return new Response('Missing or invalid ?url= parameter', { status: 400, headers: cors });
    }
    if (!/^https?:$/.test(target.protocol) || BLOCKED_HOST.test(target.hostname)) {
      return new Response('Blocked URL', { status: 403, headers: cors });
    }

    const forward = new Headers({
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
      'Accept': '*/*',
    });
    const range = request.headers.get('Range');
    if (range) forward.set('Range', range);

    let upstream;
    try {
      upstream = await fetch(target.toString(), { method: request.method, headers: forward, redirect: 'follow' });
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: cors });
    }

    const headers = new Headers(upstream.headers);
    headers.delete('set-cookie');
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  },
};
