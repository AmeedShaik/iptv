(() => {
  'use strict';

  const COUNTRIES = [['in','India'],['us','United States'],['gb','United Kingdom'],['ca','Canada'],['au','Australia'],
    ['ae','UAE'],['pk','Pakistan'],['bd','Bangladesh'],['lk','Sri Lanka'],['np','Nepal'],['sg','Singapore'],
    ['my','Malaysia'],['id','Indonesia'],['ph','Philippines'],['th','Thailand'],['vn','Vietnam'],['jp','Japan'],
    ['kr','South Korea'],['cn','China'],['hk','Hong Kong'],['tw','Taiwan'],['de','Germany'],['fr','France'],
    ['it','Italy'],['es','Spain'],['pt','Portugal'],['nl','Netherlands'],['be','Belgium'],['ch','Switzerland'],
    ['at','Austria'],['se','Sweden'],['no','Norway'],['dk','Denmark'],['fi','Finland'],['pl','Poland'],
    ['ru','Russia'],['ua','Ukraine'],['tr','Turkey'],['gr','Greece'],['il','Israel'],['sa','Saudi Arabia'],
    ['eg','Egypt'],['za','South Africa'],['ng','Nigeria'],['ke','Kenya'],['br','Brazil'],['mx','Mexico'],
    ['ar','Argentina'],['co','Colombia'],['cl','Chile']];
  const CATEGORIES = ['animation','auto','business','classic','comedy','cooking','culture','documentary','education',
    'entertainment','family','general','kids','legislative','lifestyle','movies','music','news','outdoor','public',
    'relax','religious','science','series','shop','sports','travel','weather'].map((c) => [c, c[0].toUpperCase() + c.slice(1)]);
  const LANGUAGES = [['eng','English'],['hin','Hindi'],['tel','Telugu'],['tam','Tamil'],['mal','Malayalam'],['kan','Kannada'],
    ['ben','Bengali'],['mar','Marathi'],['urd','Urdu'],['spa','Spanish'],['fra','French'],['deu','German'],
    ['por','Portuguese'],['ita','Italian'],['rus','Russian'],['ara','Arabic'],['tur','Turkish'],['zho','Chinese'],
    ['jpn','Japanese'],['kor','Korean']];
  const LISTS = { countries: COUNTRIES, categories: CATEGORIES, languages: LANGUAGES };
  // iptv-org/iptv GitHub repository playlists (GitHub Pages build first, raw repo file as fallback)
  const SOURCES = {
    countries: ['https://iptv-org.github.io/iptv/countries/{n}.m3u',
                'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/{n}.m3u'],
    categories: ['https://iptv-org.github.io/iptv/categories/{n}.m3u'],
    languages: ['https://iptv-org.github.io/iptv/languages/{n}.m3u'],
  };
  const TEST_URL = 'https://iptv-org.github.io/iptv/countries/lk.m3u';
  const TTL = 6 * 3600 * 1000;
  const PAGE = 200;

  const state = { channels: [], filtered: [], shown: 0, current: null, hls: null,
    favs: new Map(), favOnly: false, loadToken: 0, source: null };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icons = () => window.lucide && window.lucide.createIcons();
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // ---------- Toast ----------
  const Toast = {
    timer: null,
    show(msg) {
      const el = $('#toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => el.classList.remove('show'), 3800);
    },
  };

  // ---------- Proxy ----------
  // A "proxy URL" is a template such as https://my-worker.workers.dev/?url={url}
  // ({url} is replaced by the encoded target; without {url} the encoded target is appended).
  const Px = {
    cfg: { enabled: false, template: '', playlists: false },
    load() { this.cfg = { ...this.cfg, ...store.get('iptv.proxy', {}) }; },
    save() { store.set('iptv.proxy', this.cfg); },
    active() { return !!(this.cfg.enabled && this.cfg.template.trim()); },
    wrapWith(template, url) {
      const t = template.trim();
      return t.includes('{url}') ? t.replace('{url}', encodeURIComponent(url)) : t + encodeURIComponent(url);
    },
    wrap(url) { return this.wrapWith(this.cfg.template, url); },
    forPlaylist(url) { return this.active() && this.cfg.playlists ? this.wrap(url) : url; },
    isMixedContent(url) { return location.protocol === 'https:' && /^http:\/\//i.test(url); },
    updateDot() { $('#proxyDot').classList.toggle('hidden', !this.active()); },
  };

  // hls.js loader that sends every request (playlist, segments, keys) through the proxy while keeping the
  // original URL as the base for resolving relative paths inside playlists.
  function makeProxyLoader() {
    const Base = window.Hls.DefaultConfig.loader;
    return class ProxyLoader extends Base {
      load(context, config, callbacks) {
        const orig = context.url;
        context.url = Px.wrap(orig);
        const cb = { ...callbacks };
        cb.onSuccess = (resp, stats, ctx, nd) => { context.url = orig; if (resp) resp.url = orig; callbacks.onSuccess(resp, stats, ctx, nd); };
        cb.onError = (err, ctx, nd, stats) => { context.url = orig; callbacks.onError(err, ctx, nd, stats); };
        cb.onTimeout = (stats, ctx, nd) => { context.url = orig; callbacks.onTimeout(stats, ctx, nd); };
        if (callbacks.onAbort) cb.onAbort = (stats, ctx, nd) => { context.url = orig; callbacks.onAbort(stats, ctx, nd); };
        super.load(context, config, cb);
      }
    };
  }

  // ---------- M3U parsing ----------
  const ATTR_RE = /([\w-]+)="([^"]*)"/g;
  function parseM3U(text) {
    const out = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const attrs = {};
        let m;
        ATTR_RE.lastIndex = 0;
        while ((m = ATTR_RE.exec(line))) attrs[m[1]] = m[2];
        const i = line.lastIndexOf(',');
        const name = i >= 0 ? line.slice(i + 1).trim() : '';
        cur = {
          name: name || attrs['tvg-name'] || 'Unnamed',
          logo: attrs['tvg-logo'] || '',
          group: (attrs['group-title'] || 'Undefined').split(';')[0].trim() || 'Undefined',
          country: attrs['tvg-country'] || '',
          language: attrs['tvg-language'] || '',
        };
      } else if (line.startsWith('#')) {
        continue;
      } else if (cur) {
        cur.url = line;
        out.push(cur);
        cur = null;
      }
    }
    return out;
  }

  async function fetchText(url, ms = 25000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } finally { clearTimeout(timer); }
  }

  // ---------- Playlist cache (localStorage, 6 h TTL) ----------
  const Cache = {
    prefix: 'iptv.pl.',
    get(key) { return store.get(this.prefix + key, null); },
    set(key, value) {
      if (store.set(this.prefix + key, value)) return;
      this.prune(); // quota exceeded: drop old playlists and retry once
      store.set(this.prefix + key, value);
    },
    prune() {
      try { Object.keys(localStorage).filter((k) => k.startsWith(this.prefix)).forEach((k) => store.remove(k)); } catch { /* ignore */ }
    },
  };

  async function getPlaylist(key, candidates, refresh) {
    const cached = Cache.get(key);
    if (cached && !refresh && Date.now() - cached.t < TTL) return { channels: cached.channels, t: cached.t, stale: false };
    let lastErr = null;
    for (const url of candidates) {
      try {
        const text = await fetchText(Px.forPlaylist(url));
        if (!text.slice(0, 300).includes('#EXTM3U')) throw new Error('Not an M3U playlist');
        const channels = parseM3U(text);
        if (!channels.length) throw new Error('Playlist is empty');
        const t = Date.now();
        Cache.set(key, { t, channels });
        return { channels, t, stale: false };
      } catch (e) { lastErr = e; }
    }
    if (cached) return { channels: cached.channels, t: cached.t, stale: true };
    const hint = Px.active() ? '' : ' If this is a custom playlist, enable the proxy for playlists in Settings.';
    throw new Error(`Could not load playlist (${lastErr ? lastErr.message : 'unknown error'}).${hint}`);
  }

  // ---------- Theme ----------
  const Theme = {
    init() {
      document.documentElement.classList.toggle('dark', store.get('iptv.theme', 'dark') === 'dark');
      $('#themeBtn').addEventListener('click', () => {
        const dark = document.documentElement.classList.toggle('dark');
        store.set('iptv.theme', dark ? 'dark' : 'light');
      });
    },
  };

  // ---------- Favorites ----------
  const Favs = {
    init() { store.get('iptv.favs', []).forEach((c) => state.favs.set(c.url, c)); },
    has(c) { return state.favs.has(c.url); },
    toggle(c) {
      if (state.favs.has(c.url)) state.favs.delete(c.url); else state.favs.set(c.url, c);
      store.set('iptv.favs', [...state.favs.values()]);
    },
  };

  // ---------- Playlist loading ----------
  const Playlist = {
    // src: { kind, name, label } | { custom, label } | { favorites: true, label }
    open(src) {
      state.source = src;
      state.favOnly = !!src.favorites;
      $('#favOnly').classList.toggle('on', state.favOnly);
      $('#search').value = '';
      $('#groupSel').innerHTML = '<option value="">All groups</option>';
      View.openChannels();
      if (src.favorites) {
        state.channels = [];
        $('#status').textContent = `${state.favs.size} favorite${state.favs.size === 1 ? '' : 's'}`;
        List.apply();
      } else {
        this.load();
      }
    },
    async load({ refresh = false } = {}) {
      const src = state.source;
      if (!src || src.favorites) return;
      const token = ++state.loadToken;
      const key = src.custom ? 'custom:' + src.custom : `${src.kind}:${src.name}`;
      const candidates = src.custom ? [src.custom] : SOURCES[src.kind].map((t) => t.replace('{n}', src.name));
      $('#status').textContent = 'Loading playlist...';
      $('#list').innerHTML = '<div class="p-4 text-sm text-slate-500">Loading...</div>';
      try {
        const res = await getPlaylist(key, candidates, refresh);
        if (token !== state.loadToken) return;
        state.channels = res.channels;
        const groups = [...new Set(res.channels.map((c) => c.group))].sort((a, b) => a.localeCompare(b));
        $('#groupSel').innerHTML = '<option value="">All groups</option>' +
          groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
        $('#status').textContent = `${res.channels.length} channels · updated ${new Date(res.t).toLocaleString()}${res.stale ? ' (cached, download failed)' : ''}`;
        if (!src.custom) store.set('iptv.source', { kind: src.kind, name: src.name });
        List.apply();
      } catch (e) {
        if (token !== state.loadToken) return;
        state.channels = [];
        List.apply();
        $('#status').textContent = '';
        $('#list').innerHTML = `<div class="p-4 text-sm text-rose-500">${esc(e.message)}</div>`;
      }
    },
  };

  // ---------- Home screen (country / category / language picker) ----------
  const flagEmoji = (code) => String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 127397 + ch.charCodeAt(0)));
  const Home = {
    kind: 'countries',
    labelOf(kind, name) {
      const hit = LISTS[kind] && LISTS[kind].find(([v]) => v === name);
      return hit ? hit[1] : name;
    },
    render() {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.kind === this.kind));
      const q = $('#homeSearch').value.trim().toLowerCase();
      const items = LISTS[this.kind].filter(([v, l]) => !q || l.toLowerCase().includes(q) || v.includes(q));
      const glyph = (v) => (this.kind === 'countries' ? flagEmoji(v) : this.kind === 'categories' ? '\u{1F4FA}' : '\u{1F5E3}\uFE0F');
      $('#homeList').innerHTML = items.length
        ? items.map(([v, l]) => `<button class="pick" data-kind="${this.kind}" data-name="${v}">
            <span class="flag">${glyph(v)}</span><span class="pl">${esc(l)}</span></button>`).join('')
        : '<div class="col-span-full p-4 text-sm text-slate-500">No matches.</div>';

      const last = store.get('iptv.source', null);
      let chips = `<button class="chip fav" data-fav="1">\u2605 Favorites (${state.favs.size})</button>`;
      if (last && LISTS[last.kind]) {
        chips = `<button class="chip" data-kind="${last.kind}" data-name="${esc(last.name)}">Continue: ${esc(this.labelOf(last.kind, last.name))}</button>` + chips;
      }
      $('#shortcuts').innerHTML = chips;
    },
    init() {
      document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
        this.kind = t.dataset.kind;
        $('#homeSearch').value = '';
        this.render();
      }));
      $('#homeSearch').addEventListener('input', () => this.render());
      const pick = (e) => {
        const el = e.target.closest('[data-kind],[data-fav]');
        if (!el) return;
        if (el.dataset.fav) { Playlist.open({ favorites: true, label: 'Favorites' }); return; }
        const kind = el.dataset.kind, name = el.dataset.name;
        Playlist.open({ kind, name, label: this.labelOf(kind, name) });
      };
      $('#homeList').addEventListener('click', pick);
      $('#shortcuts').addEventListener('click', pick);
    },
  };

  // ---------- View switching (browser Back returns to the picker via history) ----------
  const View = {
    current: 'home',
    show(v) {
      this.current = v;
      $('#homeView').classList.toggle('hidden', v !== 'home');
      $('#channelView').classList.toggle('hidden', v !== 'channels');
      $('#backBtn').classList.toggle('hidden', v === 'home');
      $('#refreshBtn').classList.toggle('hidden', v === 'home');
      $('#title').textContent = v === 'home' ? 'IPTV Dashboard' : (state.source ? state.source.label : 'Channels');
      if (v === 'home') Home.render();
    },
    openChannels() {
      if (this.current === 'home') { try { history.pushState({ v: 'channels' }, ''); } catch { /* ignore */ } }
      this.show('channels');
    },
    back() {
      if (this.current !== 'channels') return;
      if (history.state && history.state.v === 'channels') history.back();
      else this.show('home');
    },
    init() {
      window.addEventListener('popstate', () => { if (this.current === 'channels') this.show('home'); });
      $('#backBtn').addEventListener('click', () => this.back());
    },
  };

  // ---------- Channel list ----------
  const List = {
    apply() {
      const text = $('#search').value.trim().toLowerCase();
      const group = $('#groupSel').value;
      const base = state.favOnly ? [...state.favs.values()] : state.channels;
      state.filtered = base.filter((c) =>
        (!group || c.group === group) &&
        (!text || c.name.toLowerCase().includes(text) || c.group.toLowerCase().includes(text)));
      state.shown = Math.min(PAGE, state.filtered.length);
      this.render();
      $('#list').scrollTop = 0;
    },
    row(c) {
      const active = state.current && state.current.url === c.url ? ' active' : '';
      return `<div class="ch${active}" data-url="${esc(c.url)}" role="button" tabindex="0">
        <img src="${esc(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'" />
        <div class="meta"><div class="nm">${esc(c.name)}</div><div class="gp">${esc(c.group)}</div></div>
        <button class="star${Favs.has(c) ? ' on' : ''}" data-star="1" title="Favorite"><i data-lucide="star" class="w-5 h-5"></i></button>
      </div>`;
    },
    render() {
      const items = state.filtered.slice(0, state.shown);
      let html = items.map((c) => this.row(c)).join('');
      if (state.shown < state.filtered.length) {
        html += `<button id="moreBtn" class="w-full py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700">
          Show more (${state.filtered.length - state.shown} remaining)</button>`;
      }
      if (!items.length) html = '<div class="p-4 text-sm text-slate-500">No channels found.</div>';
      const keep = $('#list').scrollTop;
      $('#list').innerHTML = html;
      $('#list').scrollTop = keep;
      $('#listCount').textContent = `${state.filtered.length} channel${state.filtered.length === 1 ? '' : 's'}`;
      icons();
    },
    find(url) {
      return state.filtered.find((c) => c.url === url) || state.channels.find((c) => c.url === url) || state.favs.get(url);
    },
    init() {
      let t;
      $('#search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.apply(), 200); });
      $('#groupSel').addEventListener('change', () => this.apply());
      $('#favOnly').addEventListener('click', () => {
        state.favOnly = !state.favOnly;
        $('#favOnly').classList.toggle('on', state.favOnly);
        this.apply();
      });
      $('#list').addEventListener('click', (e) => {
        if (e.target.closest('#moreBtn')) {
          state.shown = Math.min(state.shown + PAGE, state.filtered.length);
          this.render();
          return;
        }
        const row = e.target.closest('.ch');
        if (!row) return;
        const c = this.find(row.dataset.url);
        if (!c) return;
        if (e.target.closest('[data-star]')) { Favs.toggle(c); this.render(); Player.syncFav(); return; }
        Player.play(c);
      });
      $('#list').addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ch')) {
          e.preventDefault();
          const c = this.find(e.target.dataset.url);
          if (c) Player.play(c);
        }
      });
    },
  };

  // ---------- Player ----------
  const Player = {
    video: null,
    message(text, isErr = false, withSettings = false) {
      const o = $('#overlay');
      o.textContent = text || '';
      o.classList.toggle('err', isErr);
      if (text && withSettings) {
        const b = document.createElement('button');
        b.className = 'btn-primary';
        b.textContent = 'Open proxy settings';
        b.addEventListener('click', () => Settings.open());
        o.appendChild(b);
      }
      o.style.display = text ? 'flex' : 'none';
    },
    updateInfo() {
      const c = state.current;
      $('#npName').textContent = c ? c.name : 'Nothing playing';
      $('#npMeta').textContent = c ? [c.group, c.country, c.language].filter(Boolean).join(' · ') : '\u00a0';
      const logo = $('#npLogo');
      if (c && c.logo) { logo.src = c.logo; logo.classList.remove('hidden'); logo.onerror = () => logo.classList.add('hidden'); }
      else logo.classList.add('hidden');
      this.syncFav();
    },
    syncFav() { $('#npFav').classList.toggle('on', !!state.current && Favs.has(state.current)); },
    step(dir) {
      if (!state.filtered.length) return;
      const i = state.current ? state.filtered.findIndex((c) => c.url === state.current.url) : -1;
      const n = (i + dir + state.filtered.length) % state.filtered.length;
      if (n >= state.shown) state.shown = Math.min(n + 1, state.filtered.length);
      this.play(state.filtered[n]);
      const el = $(`.ch[data-url="${CSS.escape(state.filtered[n].url)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    },
    destroy() {
      if (state.hls) { state.hls.destroy(); state.hls = null; }
      this.video.removeAttribute('src');
      this.video.load();
    },
    loadHlsLib() {
      if (window.Hls) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'assets/vendor/hls.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('hls.js missing'));
        document.head.appendChild(s);
      });
    },
    async play(c) {
      state.current = c;
      this.updateInfo();
      List.render();
      this.destroy();
      const useProxy = Px.active();
      if (!useProxy && Px.isMixedContent(c.url)) {
        this.message('This stream uses http://, which browsers block on https pages. Add a proxy to play it.', true, true);
        return;
      }
      this.message('Loading stream...');
      try { await this.loadHlsLib(); } catch { /* fall back to the browser's own player */ }
      if (state.current !== c) return; // user picked another channel meanwhile
      const v = this.video;
      const direct = () => { v.src = useProxy ? Px.wrap(c.url) : c.url; v.play().catch(() => {}); };
      if (window.Hls && window.Hls.isSupported()) {
        const cfg = { maxBufferLength: 30 };
        if (useProxy) cfg.loader = makeProxyLoader();
        const hls = new window.Hls(cfg);
        state.hls = hls;
        let retries = 0;
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
        hls.on(window.Hls.Events.FRAG_LOADED, () => this.message(''));
        hls.on(window.Hls.Events.ERROR, (_, d) => {
          if (!d.fatal) return;
          if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && retries++ < 2) { hls.recoverMediaError(); return; }
          if (d.details === window.Hls.ErrorDetails.MANIFEST_PARSING_ERROR) { hls.destroy(); state.hls = null; direct(); return; }
          const tip = useProxy ? 'It may be offline or geo-blocked.' : 'It may be offline, geo-blocked, or blocked by CORS; a proxy can help.';
          this.message(`Stream unavailable (${d.details}). ${tip}`, true, !useProxy);
          hls.destroy();
          state.hls = null;
        });
        hls.loadSource(c.url);
        hls.attachMedia(v);
      } else {
        direct();
      }
    },
    init() {
      this.video = $('#video');
      this.video.addEventListener('playing', () => this.message(''));
      $('#prevBtn').addEventListener('click', () => this.step(-1));
      $('#nextBtn').addEventListener('click', () => this.step(1));
      $('#npFav').addEventListener('click', () => {
        if (!state.current) return;
        Favs.toggle(state.current);
        this.syncFav();
        List.render();
      });
    },
  };

  // ---------- Settings dialog (proxy) ----------
  const Settings = {
    dlg: null,
    open() {
      $('#pxEnabled').checked = Px.cfg.enabled;
      $('#pxUrl').value = Px.cfg.template;
      $('#pxPlaylists').checked = Px.cfg.playlists;
      this.result('');
      if (typeof this.dlg.showModal === 'function') { if (!this.dlg.open) this.dlg.showModal(); }
      else this.dlg.setAttribute('open', '');
    },
    close() {
      if (typeof this.dlg.close === 'function') this.dlg.close(); else this.dlg.removeAttribute('open');
    },
    result(text, ok = true) {
      const el = $('#pxResult');
      el.textContent = text;
      el.className = 'text-sm min-h-[1.25rem] ' + (ok ? 'text-emerald-500' : 'text-rose-500');
    },
    read() {
      return { enabled: $('#pxEnabled').checked, template: $('#pxUrl').value.trim(), playlists: $('#pxPlaylists').checked };
    },
    validate(cfg) {
      if (!cfg.template) return cfg.enabled ? 'Enter a proxy URL first.' : '';
      if (!/^https?:\/\/[^\s]+$/i.test(cfg.template)) return 'The proxy URL must start with https:// (or http://).';
      if (location.protocol === 'https:' && /^http:\/\//i.test(cfg.template)) {
        return 'This page is served over https, so the proxy URL must also be https://.';
      }
      return '';
    },
    async test() {
      const cfg = this.read();
      const err = this.validate({ ...cfg, enabled: true });
      if (err) { this.result(err, false); return; }
      this.result('Testing...', true);
      try {
        const text = await fetchText(Px.wrapWith(cfg.template, TEST_URL), 15000);
        if (text.slice(0, 300).includes('#EXTM3U')) this.result('Proxy works: a test playlist came through it.', true);
        else this.result('The proxy answered, but not with the expected playlist. Check the URL.', false);
      } catch (e) {
        this.result('Test failed (' + (e && e.message ? e.message : 'network or CORS error') + '). Check the proxy URL, and that ALLOWED_ORIGINS in the Worker includes this site.', false);
      }
    },
    save() {
      const cfg = this.read();
      const err = this.validate(cfg);
      if (err) { this.result(err, false); return; }
      Px.cfg = cfg;
      Px.save();
      Px.updateDot();
      this.close();
      Toast.show(Px.active() ? 'Proxy saved. Pick a channel to try it.' : 'Proxy is off.');
    },
    reset() {
      Px.cfg = { enabled: false, template: '', playlists: false };
      Px.save();
      Px.updateDot();
      this.open();
      this.result('Proxy settings cleared.', true);
    },
    init() {
      this.dlg = $('#settingsDlg');
      $('#settingsBtn').addEventListener('click', () => this.open());
      $('#dlgClose').addEventListener('click', () => this.close());
      $('#pxTest').addEventListener('click', () => this.test());
      $('#pxSave').addEventListener('click', () => this.save());
      $('#pxReset').addEventListener('click', () => this.reset());
      this.dlg.addEventListener('click', (e) => { if (e.target === this.dlg) this.close(); }); // click on backdrop
    },
  };

  // ---------- Boot ----------
  document.addEventListener('DOMContentLoaded', () => {
    Px.load();
    Theme.init();
    Favs.init();
    List.init();
    Player.init();
    Home.init();
    View.init();
    Settings.init();
    Px.updateDot();

    $('#refreshBtn').addEventListener('click', () => Playlist.load({ refresh: true }));
    $('#loadCustom').addEventListener('click', () => {
      const url = $('#customUrl').value.trim();
      if (!/^https?:\/\//i.test(url)) { Toast.show('Enter a valid http(s) playlist URL.'); return; }
      Playlist.open({ custom: url, label: 'Custom playlist' });
    });
    $('#customUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loadCustom').click(); });

    View.show('home');
    Player.updateInfo();
    icons();
  });
})();
