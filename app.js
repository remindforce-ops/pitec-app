'use strict';
(() => {
  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const main = $('#main');
  const side = $('#side');

  /* ───────── 도우미 ───────── */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const now = () => {
    const d = new Date();
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  };
  const WD = '일월화수목금토';
  const dateLabel = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return `${m}월 ${d}일 (${WD[new Date(y, m - 1, d).getDay()]})`;
  };
  const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return WD[new Date(y, m - 1, d).getDay()]; };
  const shortDate = (s) => { const [, m, d] = s.split('-'); return `${+m}/${+d}`; };
  const fullDate = (s) => { const [y, m, d] = s.split('-'); return `${y}.${m}.${d}`; };
  const isWide = () => matchMedia('(min-width: 960px)').matches;
  const RESULTS = ['정상', '관찰 필요', '재방문'];
  const typeLabel = (t) => (t === 'AS' ? 'A/S' : t === '구매' ? '구매' : '공사');
  const typeClass = (t) => (t === 'AS' ? 'as' : t === '구매' ? 'bu' : 'gs');
  const tag = (t) => `<span class="tag ${typeClass(t)}">${typeLabel(t)}</span>`;
  const won = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; };
  const itemsTotal = (items) => (items || []).reduce((t, it) => t + num(it.qty) * num(it.price), 0);
  const recTitle = (r) => (r.type === '구매' ? (r.vendor || '구매') : r.site);

  // 한글 초성 검색: 'ㅍ' → 파이프, 'ㅇㅂ' → 엘보
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const chosung = (str) => [...String(str)].map((ch) => {
    const c = ch.charCodeAt(0) - 0xac00;
    return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }).join('');
  // 일치 정도: 0 = 첫 글자부터 일치, 1 = 중간 일치, -1 = 불일치
  function matchRank(query, name) {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const n = String(name).toLowerCase();
    const c = chosung(n);
    if (n.startsWith(q) || c.startsWith(q)) return 0;
    if (n.includes(q) || c.includes(q)) return 1;
    return -1;
  }
  function searchNames(query, names, limit = 30) {
    return names.map((n) => [n, matchRank(query, n)]).filter((x) => x[1] >= 0)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'ko')).slice(0, limit).map((x) => x[0]);
  }
  const resultTag = (r) => (r ? `<span class="tag r-${RESULTS.indexOf(r)}">${esc(r)}</span>` : '');
  const siteHref = (n) => '#/site/' + encodeURIComponent(n);
  const photoCount = (r) => r.photosBefore.length + r.photosAfter.length + r.photos.length;
  const photoUrl = (p, w = 600) => (p.startsWith('data:') ? p : `https://drive.google.com/thumbnail?id=${encodeURIComponent(p)}&sz=w${w}`);
  const itemsLine = (r) => {
    const it = r.items || [];
    if (!it.length) return '';
    return `${it[0].name}${it.length > 1 ? ` 외 ${it.length - 1}건` : ''}`;
  };
  const summary = (r) => (r.type === 'AS'
    ? [r.symptom && '증상: ' + r.symptom, r.action && '조치: ' + r.action].filter(Boolean).join(' → ')
    : r.type === '구매' ? [itemsLine(r), r.total ? won(r.total) : ''].filter(Boolean).join(' · ')
    : r.work) || '';
  // 예전 형식 기록에도 구매용 칸이 있도록 채운다
  const norm = (r) => Object.assign({
    site: '', workers: [], vendor: '', items: [], total: 0, memo: '', work: '', symptom: '', action: '',
    result: '', resultMemo: '', materials: '', photos: [], photosBefore: [], photosAfter: [], author: '',
  }, r);
  const byTimeDesc = (a, b) => (b.date + b.time).localeCompare(a.date + a.time);
  const loadingHTML = '<div class="empty">불러오는 중…</div>';
  const emptyHTML = (msg, extra = '') => `<div class="empty">${esc(msg)}${extra}</div>`;

  const ls = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };

  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.className = ''; }, err ? 4500 : 2500);
  }
  function busy(msg) {
    $('#busy').hidden = !msg;
    if (msg) $('#busyMsg').textContent = msg;
  }

  /* ───────── 상태 ───────── */
  const S = {
    me: null, sites: [], workers: [], stats: {}, items: [], vendors: [],
    month: now().date.slice(0, 7), period: 'recent', type: '전체', q: '',
    recs: {}, monthIds: [], monthKey: null, sideQ: '',
  };
  function setMeta(d) {
    S.sites = d.sites; S.workers = d.workers; S.stats = d.stats;
    S.items = d.items || []; S.vendors = d.vendors || [];
    drawSideList();
    saveCache();
  }

  /* ───────── 빠른 시작: 마지막으로 본 목록을 이 기기에 보관 ───────── */
  const CACHE_KEY = 'pt.cache.v1';
  function saveCache() {
    if (DEMO || !S.me) return;
    const c = ls.get(CACHE_KEY) || {};
    const fresh = c.email === S.me.email ? c : {};
    fresh.email = S.me.email;
    fresh.me = S.me;
    fresh.meta = { sites: S.sites, workers: S.workers, stats: S.stats, items: S.items, vendors: S.vendors };
    if (S.monthKey && S.monthKey.startsWith('recent:')) {
      fresh.recs = S.monthIds.map((id) => S.recs[id]).filter(Boolean);
    }
    if (!ls.set(CACHE_KEY, fresh)) ls.del(CACHE_KEY);
  }
  function clearCache() { ls.del(CACHE_KEY); }
  const onListPage = () => ['', 'list'].includes(parseHash().page);
  function forget(id) {
    delete S.recs[id];
    S.monthKey = null;
  }

  /* ───────── 구글 로그인 ───────── */
  const TOKEN_KEY = 'pt.idtoken';
  let waiters = [];
  let gisPromise = null;

  function jwtPayload(t) {
    const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  }
  function savedToken() {
    const t = ls.get(TOKEN_KEY);
    return t && t.exp * 1000 > Date.now() + 120000 ? t.token : null;
  }
  function onCredential(res) {
    ls.set(TOKEN_KEY, { token: res.credential, exp: jwtPayload(res.credential).exp });
    $('#login').hidden = true;
    const w = waiters; waiters = [];
    w.forEach((f) => f(res.credential));
  }
  function loadGis() {
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => {
          google.accounts.id.initialize({ client_id: CFG.CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: false });
          resolve();
        };
        s.onerror = () => { gisPromise = null; reject(new Error('구글 로그인을 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }
  async function getToken(msg) {
    const t = savedToken();
    if (t) return t;
    await loadGis();
    return new Promise((resolve) => {
      waiters.push(resolve);
      busy();
      $('#login').hidden = false;
      $('#loginMsg').textContent = msg || '회사에서 등록한 구글 계정으로 로그인하세요.';
      const btn = $('#gbtn');
      btn.innerHTML = '';
      google.accounts.id.renderButton(btn, { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko', width: 260 });
      google.accounts.id.prompt();
    });
  }
  function logout() {
    ls.del(TOKEN_KEY);
    clearCache();
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    location.hash = '#/';
    location.reload();
  }

  /* ───────── 서버 호출 ───────── */
  async function call(action, data = {}) {
    if (DEMO) return demoCall(action, JSON.parse(JSON.stringify(data)));
    let msg;
    for (let i = 0; i < 3; i++) {
      const wasBusy = !$('#busy').hidden && $('#busyMsg').textContent;
      const token = await getToken(msg);
      if (wasBusy) busy(wasBusy);
      let j;
      try {
        const res = await fetch(CFG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ ...data, action, token }),
        });
        j = await res.json();
      } catch (e) {
        throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
      }
      if (j.ok) return j.data;
      if (j.code === 'AUTH' || j.code === 'DENIED') {
        ls.del(TOKEN_KEY);
        if (j.code === 'DENIED') {
          clearCache();
          msg = `${j.email} 계정은 등록되어 있지 않습니다. 관리자에게 등록을 요청하거나 다른 계정으로 로그인하세요.`;
          window.google?.accounts?.id?.disableAutoSelect();
        } else {
          msg = '로그인이 만료되었습니다. 다시 로그인하세요.';
        }
        continue;
      }
      throw new Error(j.error || '처리 중 오류가 발생했습니다.');
    }
    throw new Error('로그인하지 못했습니다.');
  }

  /* ───────── 데모 모드 (이 기기에만 저장) ───────── */
  const DEMO_KEY = 'pt.demo.v3';
  function demoSeed() {
    const d = (off) => { const x = new Date(); x.setDate(x.getDate() - off); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
    const rec = (o) => Object.assign({
      id: Math.random().toString(36).slice(2, 10), type: '공사', time: '09:00', workers: [], work: '', symptom: '', action: '',
      result: '', resultMemo: '', materials: '', photosBefore: [], photosAfter: [], photos: [],
      site: '', vendor: '', items: [], total: 0, memo: '',
      author: o.author || (o.workers && o.workers[0]) || '데모 관리자', authorEmail: 'demo@example.com', createdAt: '', updatedAt: '',
    }, o);
    return {
      sites: [
        { name: '한빛아파트 102동', address: '서울 강서구 공항대로 123', contact: '관리소장 김영희', phone: '010-1234-5678' },
        { name: '대성빌딩', address: '서울 마포구 월드컵로 45', contact: '박대성', phone: '02-333-4444' },
        { name: '미래공장', address: '경기 김포시 양촌읍 10', contact: '', phone: '' },
      ],
      workers: ['김철수', '박영호', '이민수', '최지훈'],
      items: [
        { name: 'PVC 파이프 50A', unit: '개', lastPrice: 12000 },
        { name: '엘보 50A', unit: '개', lastPrice: 1500 },
        { name: '와이어 2.5SQ', unit: 'm', lastPrice: 800 },
        { name: '절연테이프', unit: '개', lastPrice: 1000 },
        { name: '실리콘', unit: '개', lastPrice: 4500 },
      ],
      vendors: ['대한배관자재', '공구마트'],
      users: [{ email: 'staff@example.com', name: '김철수', admin: false }],
      records: [
        rec({ date: d(0), time: '09:10', site: '한빛아파트 102동', workers: ['김철수', '박영호'], work: '급수 배관 교체 완료, 통수 확인', materials: 'PVC 파이프 50A 3개, 엘보 6개' }),
        rec({ type: 'AS', date: d(0), time: '16:20', site: '대성빌딩', workers: ['이민수'], symptom: '3층 화장실 천장 누수', action: '배관 연결부 교체, 실리콘 보강', result: '정상' }),
        rec({ date: d(1), time: '08:30', site: '한빛아파트 102동', workers: ['김철수'], work: '기존 배관 철거' }),
        rec({ type: 'AS', date: d(3), time: '14:00', site: '미래공장', workers: ['최지훈'], symptom: '펌프 소음', action: '베어링 점검', result: '관찰 필요', resultMemo: '다음 주 재확인' }),
        rec({ type: '구매', date: d(0), time: '14:25', author: '김철수', vendor: '대한배관자재', items: [{ name: 'PVC 파이프 50A', qty: 3, unit: '개', price: 12000 }, { name: '엘보 50A', qty: 6, unit: '개', price: 1500 }], total: 45000, memo: '카드 결제' }),
        rec({ type: '구매', date: d(2), time: '11:00', author: '이민수', vendor: '공구마트', items: [{ name: '와이어 2.5SQ', qty: 50, unit: 'm', price: 800 }, { name: '절연테이프', qty: 10, unit: '개', price: 1000 }], total: 50000 }),
        rec({ type: 'AS', date: d(40), time: '10:30', site: '한빛아파트 102동', workers: ['이민수'], symptom: '수압 약함', action: '감압 밸브 교체', result: '정상' }),
      ],
    };
  }
  function demoCall(action, p) {
    let db = ls.get(DEMO_KEY);
    if (!db) { db = demoSeed(); ls.set(DEMO_KEY, db); }
    const me = { email: 'demo@example.com', name: '데모 관리자', admin: true };
    const ko = (a, b) => a.localeCompare(b, 'ko');
    const meta = () => {
      const stats = {};
      db.records.forEach((r) => {
        if (!r.site) return;
        const s = stats[r.site] || (stats[r.site] = { count: 0, last: '' });
        s.count++; if (r.date > s.last) s.last = r.date;
      });
      return {
        sites: [...db.sites].sort((a, b) => ko(a.name, b.name)), workers: [...db.workers].sort(ko), stats,
        items: [...(db.items || [])].sort((a, b) => ko(a.name, b.name)), vendors: [...(db.vendors || [])].sort(ko),
      };
    };
    const save = () => { if (!ls.set(DEMO_KEY, db)) throw new Error('데모 저장 공간이 가득 찼습니다. 내 정보 → 데모 초기화를 하세요.'); };
    const stamp = () => { const n = now(); return `${n.date} ${n.time}:00`; };
    const ensureSite = (name, info) => { if (!db.sites.some((s) => s.name === name)) db.sites.push({ name, address: info?.address || '', contact: info?.contact || '', phone: info?.phone || '' }); };
    const ensureWorker = (n) => { if (n && !db.workers.includes(n)) db.workers.push(n); };
    db.items = db.items || []; db.vendors = db.vendors || [];
    const ensureItem = (it) => {
      const x = db.items.find((i) => i.name === it.name);
      if (x) { if (it.unit) x.unit = it.unit; if (num(it.price)) x.lastPrice = num(it.price); }
      else db.items.push({ name: it.name, unit: it.unit || '', lastPrice: num(it.price) });
    };
    const ensureVendor = (n) => { if (n && !db.vendors.includes(n)) db.vendors.push(n); };
    const users = () => ({ owner: me.email, users: db.users });
    const fail = (m) => { throw new Error(m); };
    let out;
    switch (action) {
      case 'init': out = { me, ...meta() }; break;
      case 'list': out = db.records.filter((r) => r.date >= p.from && r.date <= p.to); break;
      case 'site': out = db.records.filter((r) => r.site === p.name); break;
      case 'get': out = db.records.find((r) => r.id === p.id) || fail('기록을 찾을 수 없습니다.'); break;
      case 'upload': out = p.data; break;
      case 'saveRecord': {
        const r = p.record;
        if (r.type === '구매') {
          r.items = (r.items || []).filter((it) => it.name);
          if (!r.items.length) fail('물품을 하나 이상 입력하세요.');
          r.items.forEach(ensureItem);
          ensureVendor(r.vendor);
          r.total = itemsTotal(r.items);
          Object.assign(r, { site: '', workers: [], work: '', symptom: '', action: '', result: '', resultMemo: '', materials: '', photosBefore: [], photosAfter: [] });
        } else {
          ensureSite(r.site, p.siteInfo);
          r.workers.forEach(ensureWorker);
          Object.assign(r, { vendor: '', items: [], total: 0, memo: '' });
          if (r.type === '공사') Object.assign(r, { symptom: '', action: '', result: '', resultMemo: '', photos: [] });
          else Object.assign(r, { work: '', photosBefore: [], photosAfter: [] });
        }
        r.updatedAt = stamp();
        const i = db.records.findIndex((x) => x.id === r.id);
        if (r.id && i >= 0) db.records[i] = { ...db.records[i], ...r };
        else db.records.push(Object.assign(r, { id: Math.random().toString(36).slice(2, 10), author: me.name, authorEmail: me.email, createdAt: r.updatedAt }));
        save();
        out = { record: db.records.find((x) => x.id === r.id), meta: meta() };
        break;
      }
      case 'deleteRecord': db.records = db.records.filter((r) => r.id !== p.id); save(); out = meta(); break;
      case 'addSite': ensureSite(p.name.trim(), p.info); save(); out = meta(); break;
      case 'updateSite': Object.assign(db.sites.find((s) => s.name === p.site.name), p.site); save(); out = meta(); break;
      case 'renameSite':
        if (db.sites.some((s) => s.name === p.newName)) fail('같은 이름의 현장이 이미 있습니다.');
        db.sites.find((s) => s.name === p.name).name = p.newName;
        db.records.forEach((r) => { if (r.site === p.name) r.site = p.newName; });
        save(); out = meta(); break;
      case 'deleteSite': db.sites = db.sites.filter((s) => s.name !== p.name); save(); out = meta(); break;
      case 'addWorker': ensureWorker(p.name.trim()); save(); out = meta(); break;
      case 'renameWorker':
        if (db.workers.includes(p.newName)) fail('같은 이름의 작업자가 이미 있습니다.');
        db.workers = db.workers.map((w) => (w === p.name ? p.newName : w));
        db.records.forEach((r) => { r.workers = r.workers.map((w) => (w === p.name ? p.newName : w)); });
        save(); out = meta(); break;
      case 'deleteWorker': db.workers = db.workers.filter((w) => w !== p.name); save(); out = meta(); break;
      case 'renameItem':
        if (db.items.some((i) => i.name === p.newName)) fail('같은 이름의 물품이 이미 있습니다.');
        db.items.find((i) => i.name === p.name).name = p.newName;
        db.records.forEach((r) => (r.items || []).forEach((it) => { if (it.name === p.name) it.name = p.newName; }));
        save(); out = meta(); break;
      case 'deleteItem': db.items = db.items.filter((i) => i.name !== p.name); save(); out = meta(); break;
      case 'renameVendor':
        if (db.vendors.includes(p.newName)) fail('같은 이름의 구매처가 이미 있습니다.');
        db.vendors = db.vendors.map((v) => (v === p.name ? p.newName : v));
        db.records.forEach((r) => { if (r.vendor === p.name) r.vendor = p.newName; });
        save(); out = meta(); break;
      case 'deleteVendor': db.vendors = db.vendors.filter((v) => v !== p.name); save(); out = meta(); break;
      case 'users': out = users(); break;
      case 'saveUser': {
        const email = p.user.email.trim().toLowerCase();
        const u = db.users.find((x) => x.email === email);
        if (u) Object.assign(u, { name: p.user.name, admin: !!p.user.admin });
        else db.users.push({ email, name: p.user.name, admin: !!p.user.admin });
        save(); out = users(); break;
      }
      case 'deleteUser': db.users = db.users.filter((u) => u.email !== p.email); save(); out = users(); break;
      default: fail('알 수 없는 요청');
    }
    return new Promise((r) => setTimeout(() => r(JSON.parse(JSON.stringify(out))), 120));
  }

  /* ───────── 사이드바 (PC 현장 목록) ───────── */
  function renderSide() {
    side.innerHTML = `
      <div class="side-head"><span>현장</span><span class="muted small" id="sideCount"></span></div>
      <input type="search" id="sideQ" placeholder="현장 검색" value="${esc(S.sideQ)}">
      <nav class="site-list" id="sideList"></nav>`;
    $('#sideQ').addEventListener('input', (e) => { S.sideQ = e.target.value.trim(); drawSideList(); });
    drawSideList();
  }
  function drawSideList() {
    const box = $('#sideList');
    if (!box) return;
    const q = S.sideQ.toLowerCase();
    const cur = currentSite();
    const list = S.sites.filter((s) => !q || s.name.toLowerCase().includes(q));
    $('#sideCount').textContent = S.sites.length + '곳';
    box.innerHTML = list.map((s) => `<a href="${siteHref(s.name)}" class="${cur === s.name ? 'on' : ''}">
        <span>${esc(s.name)}</span><span class="muted">${S.stats[s.name]?.count || 0}</span></a>`).join('')
      || '<p class="muted small" style="padding:0 6px">현장이 없습니다</p>';
  }
  function currentSite() {
    const h = parseHash();
    return h.page === 'site' ? h.arg : null;
  }

  /* ───────── 라우팅 ───────── */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs = ''] = h.split('?');
    const [page = '', ...rest] = path.split('/');
    let arg = rest.join('/');
    try { arg = decodeURIComponent(arg); } catch (e) { /* 그대로 */ }
    return { page, arg, q: new URLSearchParams(qs) };
  }
  const PAGES = {
    '': pageList, list: pageList, new: pageForm, edit: pageForm, view: pageView,
    site: pageSite, sites: pageSites, admin: pageAdmin, me: pageMe,
  };
  async function route() {
    const { page, arg, q } = parseHash();
    const fn = PAGES[page] || pageList;
    const nav = page === 'edit' ? 'new' : page === 'view' || page === '' ? 'list' : page === 'site' ? 'sites' : page;
    $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
    const sub = { list: '기록', sites: '현장', new: page === 'edit' ? '기록 수정' : '새 기록', me: '내 정보', admin: '관리' }[nav] || '기록';
    $('#brandSub').textContent = sub;
    document.title = `파이텍 앱 · ${sub}`;
    pageClick = null;
    drawSideList();
    window.scrollTo(0, 0);
    try {
      await fn(arg, q);
    } catch (e) {
      main.innerHTML = emptyHTML(e.message, '<br><button class="btn" onclick="location.reload()">다시 시도</button>');
    }
  }

  /* ───────── 목록 ───────── */
  // 조회 기간: 최근 30일(기본) 또는 선택한 달
  function range() {
    if (S.period === 'recent') {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const to = now().date;
      return { key: 'recent:' + to, from, to };
    }
    return { key: S.month, from: S.month + '-01', to: S.month + '-31' };
  }
  async function loadMonth() {
    const { key, from, to } = range();
    if (S.monthKey === key) return;
    const list = (await call('list', { from, to })).map(norm);
    list.forEach((r) => { S.recs[r.id] = r; });
    S.monthIds = list.map((r) => r.id);
    S.monthKey = key;
    saveCache();
  }
  function filtered() {
    const q = S.q.toLowerCase();
    return S.monthIds.map((id) => S.recs[id]).filter(Boolean)
      .filter((r) => S.type === '전체' || r.type === S.type)
      .filter((r) => !q || [r.site, r.workers.join(' '), r.work, r.symptom, r.action, r.resultMemo, r.materials, r.author,
        r.vendor, r.memo, (r.items || []).map((it) => it.name).join(' ')]
        .join(' ').toLowerCase().includes(q))
      .sort(byTimeDesc);
  }
  function shiftMonth(delta) {
    const [y, m] = S.month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    S.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  async function pageList() {
    main.innerHTML = `
      <div class="toolbar">
        <input type="search" id="q" placeholder="현장명, 작업자, 물품, 구매처 검색" value="${esc(S.q)}">
        <div class="row">
          <div class="seg" id="typeSeg">${['전체', '공사', 'AS', '구매'].map((t) => `<button type="button" data-t="${t}" class="${S.type === t ? 'on' : ''}">${t === 'AS' ? 'A/S' : t}</button>`).join('')}</div>
          <div class="monthnav">
            <button class="btn ${S.period === 'recent' ? 'on' : ''}" id="mRecent">최근 30일</button>
            <button class="btn" id="mPrev" aria-label="이전 달">‹</button>
            <input type="month" id="month" value="${S.month}">
            <button class="btn" id="mNext" aria-label="다음 달">›</button>
          </div>
          <button class="btn wide-only" id="csv">엑셀 저장</button>
        </div>
      </div>
      <div id="res">${loadingHTML}</div>`;

    $('#q').addEventListener('input', (e) => { S.q = e.target.value.trim(); drawList(); });
    $('#typeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      S.type = b.dataset.t;
      $$('#typeSeg button').forEach((x) => x.classList.toggle('on', x === b));
      drawList();
    });
    const reload = async () => {
      $('#month').value = S.month;
      $('#mRecent').classList.toggle('on', S.period === 'recent');
      $('#month').classList.toggle('dim', S.period === 'recent');
      $('#res').innerHTML = loadingHTML;
      try { await loadMonth(); drawList(); } catch (e) { $('#res').innerHTML = emptyHTML(e.message); }
    };
    $('#mRecent').addEventListener('click', () => { S.period = 'recent'; S.month = now().date.slice(0, 7); reload(); });
    $('#month').addEventListener('change', (e) => { if (e.target.value) { S.period = 'month'; S.month = e.target.value; reload(); } });
    $('#mPrev').addEventListener('click', () => { if (S.period === 'month') shiftMonth(-1); S.period = 'month'; reload(); });
    $('#mNext').addEventListener('click', () => { if (S.period === 'month') shiftMonth(1); S.period = 'month'; reload(); });
    $('#csv').addEventListener('click', () => exportCsv(filtered()));
    await reload();
  }

  function drawList() {
    const box = $('#res');
    const rg = range();
    if (!box || S.monthKey !== rg.key) return;
    const list = filtered();
    const [y, m] = S.month.split('-');
    const cnt = (t) => list.filter((r) => r.type === t).length;
    const buys = list.filter((r) => r.type === '구매');
    const buyTotal = buys.reduce((t, r) => t + num(r.total), 0);
    const label = S.period === 'recent' ? `최근 30일 (${shortDate(rg.from)} ~ ${shortDate(rg.to)})` : `${+y}년 ${+m}월`;
    const head = `<p class="sum">${label} · ${list.length}건 (공사 ${cnt('공사')} · A/S ${cnt('AS')} · 구매 ${buys.length})${buys.length ? ` · 구매 합계 <b>${won(buyTotal)}</b>` : ''}${S.refreshing ? '<span class="updating">업데이트 중…</span>' : ''}</p>`;
    if (!list.length) {
      box.innerHTML = head + emptyHTML(S.q || S.type !== '전체' ? '조건에 맞는 기록이 없습니다.' : (S.period === 'recent' ? '최근 30일 동안의 기록이 없습니다.' : '이 달의 기록이 없습니다.'),
        '<br><a class="btn primary" href="#/new">+ 새 기록</a>');
      return;
    }
    if (isWide()) {
      box.innerHTML = head + `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>날짜</th><th>시간</th><th>구분</th><th>현장 / 구매처</th><th>내용</th><th>작업자</th><th>작성자</th><th>사진</th></tr></thead>
        <tbody>${list.map((r) => `<tr data-go="#/view/${esc(r.id)}">
          <td class="nowrap">${shortDate(r.date)} <span class="muted small">${dow(r.date)}</span></td>
          <td class="nowrap">${esc(r.time)}</td>
          <td class="nowrap">${tag(r.type)}${resultTag(r.result)}</td>
          <td class="nowrap">${r.type === '구매' ? esc(r.vendor || '-') : `<a href="${siteHref(r.site)}">${esc(r.site)}</a>`}</td>
          <td class="clip">${esc(summary(r))}</td>
          <td>${esc(r.workers.join(', '))}</td>
          <td class="nowrap">${esc(r.author || '')}</td>
          <td>${photoCount(r) || ''}</td></tr>`).join('')}</tbody></table></div>`;
      return;
    }
    let html = head;
    let day = '';
    list.forEach((r) => {
      if (r.date !== day) { day = r.date; html += `<p class="day">${dateLabel(day)}</p>`; }
      const n = photoCount(r);
      html += `<div class="card" data-go="#/view/${esc(r.id)}">
        <div class="card-top">${tag(r.type)}${resultTag(r.result)}<span class="time">${r.author ? `<span class="author">${esc(r.author)}</span>` : ''}${esc(r.time)}</span></div>
        ${r.type === '구매' ? `<span class="card-title">${esc(r.vendor || '구매')}</span>` : `<a class="card-title" href="${siteHref(r.site)}">${esc(r.site)}</a>`}
        ${summary(r) ? `<div class="line">${esc(summary(r))}</div>` : ''}
        <div class="muted small">${r.type === '구매' ? (n ? `영수증 ${n}` : '영수증 없음') : `${esc(r.workers.join(', ') || '작업자 없음')}${n ? ` · 사진 ${n}` : ''}`}</div></div>`;
    });
    box.innerHTML = html;
  }

  function exportCsv(list) {
    if (!list.length) { toast('내보낼 기록이 없습니다', true); return; }
    const head = ['날짜', '시간', '구분', '현장', '작업자', '작업내용', '증상', '조치', '조치후상태', '상태메모', '사용자재',
      '구매처', '구매물품', '구매금액', '메모', '사진수', '작성자'];
    const itemsText = (r) => (r.items || []).map((it) => `${it.name} ${num(it.qty)}${it.unit || ''} × ${won(it.price)}`).join(' / ');
    const rows = list.map((r) => [r.date, r.time, typeLabel(r.type), r.site, r.workers.join(', '), r.work, r.symptom, r.action,
      r.result, r.resultMemo, r.materials, r.vendor, itemsText(r), r.type === '구매' ? num(r.total) : '', r.memo, photoCount(r), r.author]);
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `파이텍_기록_${S.period === 'recent' ? '최근30일_' + now().date : S.month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ───────── 상세 ───────── */
  const kv = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');
  const gallery = (title, arr) => (arr.length
    ? `<section><h3>${title} <span class="muted small">${arr.length}장</span></h3><div class="gallery">${arr.map((p) => `<img src="${esc(photoUrl(p, 400))}" data-full="${esc(p)}" loading="lazy" alt="${title}">`).join('')}</div></section>`
    : '');

  async function pageView(id) {
    let r = S.recs[id];
    if (!r) {
      main.innerHTML = loadingHTML;
      r = norm(await call('get', { id }));
      S.recs[id] = r;
    }
    const canDel = S.me.admin || r.authorEmail === S.me.email;
    if (r.type === '구매') { viewPurchase(r, canDel); bindDelete(id); return; }
    const photos = r.type === '공사'
      ? (r.photosBefore.length || r.photosAfter.length
        ? `<div class="pair">${gallery('작업 전 사진', r.photosBefore) || '<section><h3>작업 전 사진</h3><p class="muted small">없음</p></section>'}${gallery('작업 후 사진', r.photosAfter) || '<section><h3>작업 후 사진</h3><p class="muted small">없음</p></section>'}</div>`
        : '')
      : gallery('사진', r.photos);
    main.innerHTML = `
      <div class="page-head"><button class="back" data-back>‹ 뒤로</button></div>
      <article class="panel">
        <div class="rec-head">${tag(r.type)}${resultTag(r.result)}<span class="muted">${fullDate(r.date)} (${dow(r.date)}) ${esc(r.time)}</span></div>
        <a class="rec-site" href="${siteHref(r.site)}">${esc(r.site)} ›</a>
        <dl class="kv">
          ${kv('작업자', r.workers.join(', ') || '-')}
          ${r.type === '공사' ? kv('작업 내용', r.work) : kv('증상', r.symptom) + kv('조치', r.action) + kv('조치 후 상태', [r.result, r.resultMemo].filter(Boolean).join(' · '))}
          ${kv('사용 자재', r.materials)}
        </dl>
        ${photos}
        <p class="muted small foot">작성 ${esc(r.author)} · ${esc(r.createdAt)}${r.updatedAt && r.updatedAt !== r.createdAt ? ` · 수정 ${esc(r.updatedAt)}` : ''}</p>
        <div class="actions">
          <a class="btn primary" href="#/edit/${esc(r.id)}">수정</a>
          <a class="btn" href="#/new?site=${encodeURIComponent(r.site)}&type=${r.type}">이 현장 새 기록</a>
          ${canDel ? '<button class="btn danger" id="del">삭제</button>' : ''}
        </div>
      </article>`;
    bindDelete(id);
  }
  function bindDelete(id) {
    $('#del')?.addEventListener('click', async () => {
      if (!confirm('이 기록을 삭제할까요? 첨부 사진도 함께 삭제됩니다.')) return;
      busy('삭제 중…');
      try {
        setMeta(await call('deleteRecord', { id }));
        forget(id);
        busy(); toast('삭제했습니다');
        location.replace('#/');
      } catch (e) { busy(); toast(e.message, true); }
    });
  }
  function viewPurchase(r, canDel) {
    const rows = (r.items || []).map((it) => `<tr>
        <td>${esc(it.name)}</td>
        <td class="num">${num(it.qty).toLocaleString('ko-KR')}${esc(it.unit || '')}</td>
        <td class="num">${won(it.price)}</td>
        <td class="num">${won(num(it.qty) * num(it.price))}</td></tr>`).join('');
    main.innerHTML = `
      <div class="page-head"><button class="back" data-back>‹ 뒤로</button></div>
      <article class="panel">
        <div class="rec-head">${tag(r.type)}<span class="muted">${fullDate(r.date)} (${dow(r.date)}) ${esc(r.time)}</span></div>
        <div class="rec-site">${esc(r.vendor || '구매처 없음')}</div>
        <div class="tbl-wrap" style="margin-top:14px"><table class="tbl items-tbl">
          <thead><tr><th>물품</th><th class="num">수량</th><th class="num">단가</th><th class="num">금액</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3">합계</td><td class="num">${won(r.total)}</td></tr></tfoot>
        </table></div>
        ${r.memo ? `<dl class="kv"><dt>메모</dt><dd>${esc(r.memo)}</dd></dl>` : ''}
        ${gallery('영수증 사진', r.photos)}
        <p class="muted small foot">작성 ${esc(r.author)} · ${esc(r.createdAt)}${r.updatedAt && r.updatedAt !== r.createdAt ? ` · 수정 ${esc(r.updatedAt)}` : ''}</p>
        <div class="actions">
          <a class="btn primary" href="#/edit/${esc(r.id)}">수정</a>
          <a class="btn" href="#/new?type=구매">새 구매 기록</a>
          ${canDel ? '<button class="btn danger" id="del">삭제</button>' : ''}
        </div>
      </article>`;
  }

  /* ───────── 현장별 이력 ───────── */
  async function pageSite(name) {
    main.innerHTML = loadingHTML;
    const recs = (await call('site', { name })).map(norm).sort(byTimeDesc);
    recs.forEach((r) => { S.recs[r.id] = r; });
    let filter = '전체';
    const draw = () => {
      const s = S.sites.find((x) => x.name === name) || { name, address: '', contact: '', phone: '' };
      const nGs = recs.filter((r) => r.type === '공사').length;
      const list = recs.filter((r) => filter === '전체' || r.type === filter);
      let year = '';
      const tl = list.map((r) => {
        const y = r.date.slice(0, 4);
        const yh = y !== year && (year || y !== now().date.slice(0, 4)) ? `<p class="tl-year">${y}년</p>` : '';
        year = y;
        const n = photoCount(r);
        return `${yh}<div class="tl-item ${r.type === 'AS' ? 'as' : 'gs'}" data-go="#/view/${esc(r.id)}">
          ${tag(r.type)}${resultTag(r.result)}<span class="muted small">${shortDate(r.date)} (${dow(r.date)}) ${esc(r.time)}</span>
          <div class="tl-body">${esc(summary(r) || '(내용 없음)')}</div>
          <div class="muted small">${esc(r.workers.join(', ') || '작업자 없음')}${n ? ` · 사진 ${n}` : ''}</div></div>`;
      }).join('');
      main.innerHTML = `
        <div class="page-head"><button class="back wide-hide" data-back>‹ 뒤로</button></div>
        <section class="panel">
          <h2>${esc(name)}</h2>
          <div class="info-lines" id="siteInfo">
            <p><span class="k">주소</span><span>${s.address ? `<a href="https://map.naver.com/p/search/${encodeURIComponent(s.address)}" target="_blank" rel="noopener">${esc(s.address)}</a>` : '<span class="muted">-</span>'}</span></p>
            <p><span class="k">담당자</span><span>${esc(s.contact) || '<span class="muted">-</span>'}</span></p>
            <p><span class="k">연락처</span><span>${s.phone ? `<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>` : '<span class="muted">-</span>'}</span></p>
          </div>
          <form id="siteForm" class="form" hidden>
            <label>주소<input name="address" value="${esc(s.address)}"></label>
            <div class="grid2"><label>담당자<input name="contact" value="${esc(s.contact)}"></label><label>연락처<input name="phone" type="tel" value="${esc(s.phone)}"></label></div>
            <div class="actions"><button class="btn primary">저장</button><button type="button" class="btn" id="siteCancel">취소</button></div>
          </form>
          <div class="stats">
            <div class="stat"><span>공사</span><b>${nGs}회</b></div>
            <div class="stat"><span>A/S</span><b>${recs.length - nGs}회</b></div>
            <div class="stat"><span>최근</span><b>${recs[0] ? shortDate(recs[0].date) : '-'}</b></div>
          </div>
          <div class="actions" id="siteBtns">
            <a class="btn primary" href="#/new?site=${encodeURIComponent(name)}">+ 이 현장 새 기록</a>
            ${S.sites.some((x) => x.name === name) ? '<button class="btn" id="siteEdit">현장 정보 수정</button>' : ''}
          </div>
        </section>
        <section class="panel">
          <div class="page-head"><h3 class="grow" style="margin:0">작업 이력</h3>
            <div class="seg" id="tlSeg">${['전체', '공사', 'AS'].map((t) => `<button data-t="${t}" class="${filter === t ? 'on' : ''}">${t === 'AS' ? 'A/S' : t}</button>`).join('')}</div></div>
          ${tl || '<p class="muted">기록이 없습니다.</p>'}
        </section>`;
      $('#tlSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { filter = b.dataset.t; draw(); } });
      $('#siteEdit')?.addEventListener('click', () => { $('#siteForm').hidden = false; $('#siteInfo').hidden = true; $('#siteBtns').hidden = true; });
      $('#siteCancel').addEventListener('click', () => draw());
      $('#siteForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        busy('저장 중…');
        try {
          setMeta(await call('updateSite', { site: { name, address: f.address.value.trim(), contact: f.contact.value.trim(), phone: f.phone.value.trim() } }));
          busy(); toast('현장 정보를 저장했습니다'); draw();
        } catch (err) { busy(); toast(err.message, true); }
      });
    };
    draw();
  }

  /* ───────── 현장 목록 ───────── */
  async function pageSites() {
    let q = '';
    main.innerHTML = `
      <div class="page-head"><h2 class="grow">현장</h2></div>
      <div class="toolbar"><input type="search" id="sq" placeholder="현장명, 주소 검색"></div>
      <div id="sl"></div>
      <form class="panel form" id="addSite">
        <h3 style="margin-top:0">새 현장 추가</h3>
        <input name="name" placeholder="현장명" required>
        <input name="address" placeholder="주소 (선택)" style="margin-top:8px">
        <div class="grid2" style="margin-top:8px"><input name="contact" placeholder="담당자 (선택)"><input name="phone" type="tel" placeholder="연락처 (선택)"></div>
        <button class="btn primary block" style="margin-top:12px">현장 추가</button>
      </form>`;
    const draw = () => {
      const k = q.toLowerCase();
      const list = S.sites.filter((s) => !k || (s.name + ' ' + s.address).toLowerCase().includes(k));
      $('#sl').innerHTML = list.map((s) => {
        const st = S.stats[s.name];
        return `<div class="card" data-go="${siteHref(s.name)}">
          <div class="card-top"><span class="card-title">${esc(s.name)}</span><span class="time">${st ? `${st.count}건 · 최근 ${shortDate(st.last)}` : '기록 없음'}</span></div>
          ${s.address ? `<div class="line muted">${esc(s.address)}</div>` : ''}</div>`;
      }).join('') || emptyHTML(q ? '검색 결과가 없습니다.' : '등록된 현장이 없습니다.');
    };
    $('#sq').addEventListener('input', (e) => { q = e.target.value.trim(); draw(); });
    $('#addSite').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.elements.name.value.trim();
      if (S.sites.some((s) => s.name === name)) { toast('이미 등록된 현장입니다', true); return; }
      busy('추가 중…');
      try {
        setMeta(await call('addSite', { name, info: { address: f.address.value.trim(), contact: f.contact.value.trim(), phone: f.phone.value.trim() } }));
        busy(); toast('현장을 추가했습니다'); f.reset(); draw();
      } catch (err) { busy(); toast(err.message, true); }
    });
    draw();
  }

  /* ───────── 새 기록 / 수정 ───────── */
  function compress(file, max = DEMO ? 900 : 1600, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`사진을 읽을 수 없습니다: ${file.name}`)); };
      img.src = url;
    });
  }

  async function pageForm(id, q) {
    let r;
    if (id) {
      if (!S.recs[id]) { main.innerHTML = loadingHTML; S.recs[id] = norm(await call('get', { id })); }
      r = JSON.parse(JSON.stringify(S.recs[id]));
    } else {
      const n = now();
      const t = q.get('type');
      r = norm({
        type: t === 'AS' || t === '구매' ? t : '공사', date: n.date, time: n.time, site: q.get('site') || '',
        workers: S.workers.includes(S.me.name) ? [S.me.name] : [],
      });
    }
    const isBuy = r.type === '구매';
    const ph = {
      photosBefore: { keep: [...r.photosBefore], add: [] },
      photosAfter: { keep: [...r.photosAfter], add: [] },
      photos: { keep: isBuy ? [] : [...r.photos], add: [] },
      receipt: { keep: isBuy ? [...r.photos] : [], add: [] },
    };
    const picked = new Set(r.workers);
    const extraWorkers = r.workers.filter((w) => !S.workers.includes(w));
    const blankItem = () => ({ name: '', qty: '1', unit: '', price: '' });
    const rows = r.items.length
      ? r.items.map((it) => ({ name: it.name, qty: String(it.qty ?? ''), unit: it.unit || '', price: String(it.price ?? '') }))
      : [blankItem()];
    let dirty = false;

    main.innerHTML = `
      <div class="page-head"><button class="back" data-back>‹ 취소</button><h2 class="grow">${id ? '기록 수정' : '새 기록'}</h2></div>
      <form id="f" class="panel form" autocomplete="off" novalidate>
        <div class="seg big" id="typeSeg"><button type="button" data-t="공사">공사</button><button type="button" data-t="AS">A/S</button><button type="button" data-t="구매">구매</button></div>
        <div class="grid2">
          <label>날짜<input type="date" name="date" value="${esc(r.date)}" required></label>
          <label>시간<input type="time" name="time" value="${esc(r.time)}"></label>
        </div>
        <div data-for="공사 AS">
          <label>현장명
            <div class="combo"><input name="site" value="${esc(r.site)}" placeholder="현장명 입력 또는 선택 (초성 가능)"><div class="combo-list" id="siteList" hidden></div></div>
          </label>
          <div id="newSiteBox" class="subbox" hidden>
            <p><b>새 현장</b>으로 등록됩니다. 아는 정보만 입력하세요.</p>
            <input name="ns_address" placeholder="주소 (선택)">
            <div class="grid2"><input name="ns_contact" placeholder="담당자 (선택)"><input name="ns_phone" type="tel" placeholder="연락처 (선택)"></div>
          </div>
          <div class="field"><span class="lbl">작업자 <span class="muted">(여러 명 선택 가능)</span></span>
            <div class="chips" id="wChips"></div>
            <div class="addrow" id="wAdd" hidden><input id="wNew" placeholder="새 작업자 이름" enterkeyhint="done"><button type="button" class="btn" id="wOk">추가</button></div>
          </div>
        </div>
        <div data-for="공사">
          <label>작업 내용<textarea name="work" rows="3" placeholder="작업한 내용">${esc(r.work)}</textarea></label>
          <div class="field"><span class="lbl">작업 전 사진 <span class="muted">(선택)</span></span><div class="photos" data-g="photosBefore"></div></div>
          <div class="field"><span class="lbl">작업 후 사진 <span class="muted">(선택)</span></span><div class="photos" data-g="photosAfter"></div></div>
        </div>
        <div data-for="AS">
          <label>증상<textarea name="symptom" rows="2" placeholder="고객이 말한 증상, 확인한 문제">${esc(r.symptom)}</textarea></label>
          <label>조치<textarea name="action" rows="2" placeholder="한 조치">${esc(r.action)}</textarea></label>
          <div class="field"><span class="lbl">조치 후 상태</span>
            <div class="chips" id="rChips">${RESULTS.map((x) => `<button type="button" class="chip" data-r="${x}">${x}</button>`).join('')}</div>
            <input name="resultMemo" value="${esc(r.resultMemo)}" placeholder="상태 메모 (선택)">
          </div>
          <div class="field"><span class="lbl">사진 <span class="muted">(선택)</span></span><div class="photos" data-g="photos"></div></div>
        </div>
        <label data-for="공사 AS">사용 자재 <span class="muted" style="font-weight:400">(선택)</span><textarea name="materials" rows="2" placeholder="예: PVC 파이프 50A 2개, 실리콘 1개">${esc(r.materials)}</textarea></label>
        <div data-for="구매">
          <label>구매처
            <div class="combo"><input name="vendor" value="${esc(r.vendor)}" placeholder="구매처 입력 또는 선택 (초성 가능)"><div class="combo-list" id="vendorList" hidden></div></div>
          </label>
          <p class="hint" id="newVendorHint" hidden>새 구매처로 등록됩니다.</p>
          <div class="field"><span class="lbl">물품 <span class="muted">(첫 글자나 초성으로 검색)</span></span>
            <div id="itemRows" class="item-rows"></div>
            <button type="button" class="btn sm add-item" id="addItem">+ 물품 추가</button>
            <div class="items-total"><span>합계</span><b id="itemsTotal">0원</b></div>
          </div>
          <div class="field"><span class="lbl">영수증 사진 <span class="muted">(선택)</span></span><div class="photos" data-g="receipt"></div></div>
          <label>메모 <span class="muted" style="font-weight:400">(선택)</span><textarea name="memo" rows="2" placeholder="예: 카드 결제, 현장 사용분">${esc(r.memo)}</textarea></label>
        </div>
        <button class="btn primary block" type="submit">저장</button>
      </form>`;

    const f = $('#f');
    f.addEventListener('input', () => { dirty = true; });

    // 공통: 이름 목록에서 고르는 입력칸 (첫 글자·초성 검색)
    function bindCombo(input, listEl, getNames, onPick, newLabel, extra) {
      const draw = () => {
        const v = input.value.trim();
        const names = searchNames(v, getNames());
        const known = getNames().includes(v);
        listEl.innerHTML = names.map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}${extra ? extra(n) : ''}</button>`).join('')
          + (v && !known ? `<button type="button" class="add" data-new>+ '${esc(v)}' ${newLabel}</button>` : '');
        listEl.hidden = !listEl.innerHTML;
      };
      input.addEventListener('focus', draw);
      input.addEventListener('input', draw);
      input.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 150));
      listEl.addEventListener('mousedown', (e) => e.preventDefault());
      listEl.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.n != null) input.value = b.dataset.n;
        listEl.hidden = true;
        dirty = true;
        onPick(b.dataset.n != null ? b.dataset.n : null);
      });
    }

    // 구분
    const drawType = () => {
      $$('#typeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === r.type));
      $$('[data-for]', f).forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(r.type); });
    };
    $('#typeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      r.type = b.dataset.t; dirty = true; drawType();
    });
    drawType();

    // 현장명 선택 / 추가
    const siteIn = f.site;
    const isKnown = (v) => S.sites.some((s) => s.name === v);
    const drawNewSite = () => { const v = siteIn.value.trim(); $('#newSiteBox').hidden = !v || isKnown(v); };
    bindCombo(siteIn, $('#siteList'), () => S.sites.map((s) => s.name), (pickedName) => {
      drawNewSite();
      if (pickedName == null) f.ns_address.focus(); else siteIn.blur();
    }, '새 현장으로 추가', (n) => {
      const s = S.sites.find((x) => x.name === n);
      return s && s.address ? ` <span class="muted small">${esc(s.address)}</span>` : '';
    });
    siteIn.addEventListener('input', drawNewSite);
    drawNewSite();

    // 작업자
    const drawWorkers = () => {
      const all = [...new Set([...S.workers, ...extraWorkers])];
      $('#wChips').innerHTML = all.map((w) => `<button type="button" class="chip ${picked.has(w) ? 'on' : ''}" data-w="${esc(w)}">${picked.has(w) ? '✓ ' : ''}${esc(w)}</button>`).join('')
        + '<button type="button" class="chip add" id="wAddBtn">+ 추가</button>';
    };
    $('#wChips').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'wAddBtn') { $('#wAdd').hidden = false; $('#wNew').focus(); return; }
      const w = b.dataset.w;
      if (picked.has(w)) picked.delete(w); else picked.add(w);
      dirty = true; drawWorkers();
    });
    const addWorker = () => {
      const name = $('#wNew').value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
      if (!name) return;
      if (!S.workers.includes(name) && !extraWorkers.includes(name)) extraWorkers.push(name);
      picked.add(name);
      $('#wNew').value = '';
      $('#wAdd').hidden = true;
      dirty = true; drawWorkers();
    };
    $('#wOk').addEventListener('click', addWorker);
    $('#wNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWorker(); } });
    drawWorkers();

    // 조치 후 상태
    const drawResult = () => $$('#rChips .chip').forEach((b) => b.classList.toggle('on', b.dataset.r === r.result));
    $('#rChips').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      r.result = r.result === b.dataset.r ? '' : b.dataset.r;
      dirty = true; drawResult();
    });
    drawResult();

    // 구매처
    const vendorIn = f.vendor;
    const drawVendorHint = () => { const v = vendorIn.value.trim(); $('#newVendorHint').hidden = !v || S.vendors.includes(v); };
    bindCombo(vendorIn, $('#vendorList'), () => S.vendors, () => { drawVendorHint(); vendorIn.blur(); }, '새 구매처로 등록');
    vendorIn.addEventListener('input', drawVendorHint);
    drawVendorHint();

    // 물품 목록
    const itemInfo = (n) => S.items.find((it) => it.name === n);
    const drawTotal = () => {
      $('#itemsTotal').textContent = won(itemsTotal(rows));
      $$('#itemRows .item-row').forEach((el) => {
        const it = rows[+el.dataset.i];
        el.querySelector('.it-amt').textContent = won(num(it.qty) * num(it.price));
        el.querySelector('.it-new').hidden = !it.name.trim() || !!itemInfo(it.name.trim());
      });
    };
    const drawRows = () => {
      $('#itemRows').innerHTML = rows.map((it, i) => `
        <div class="item-row" data-i="${i}">
          <div class="item-top">
            <div class="combo"><input class="it-name" value="${esc(it.name)}" placeholder="물품명"><div class="combo-list" hidden></div></div>
            <button type="button" class="it-x" aria-label="물품 빼기">×</button>
          </div>
          <div class="item-nums">
            <label class="mini">수량<input class="it-qty" inputmode="decimal" value="${esc(it.qty)}"></label>
            <label class="mini">단위<input class="it-unit" value="${esc(it.unit)}" placeholder="개"></label>
            <label class="mini">단가<input class="it-price" inputmode="numeric" value="${esc(it.price)}" placeholder="0"></label>
            <div class="mini amt"><span>금액</span><b class="it-amt"></b></div>
          </div>
          <p class="hint it-new" hidden>새 물품으로 등록됩니다. 단위를 적어 두면 다음부터 자동으로 들어갑니다.</p>
        </div>`).join('');
      $$('#itemRows .item-row').forEach((el) => {
        const i = +el.dataset.i;
        const nameIn = el.querySelector('.it-name');
        bindCombo(nameIn, el.querySelector('.combo-list'), () => S.items.map((it) => it.name), (pickedName) => {
          rows[i].name = nameIn.value.trim();
          const info = pickedName && itemInfo(pickedName);
          if (info) {
            if (!rows[i].unit && info.unit) rows[i].unit = info.unit;
            if (!num(rows[i].price) && info.lastPrice) rows[i].price = String(info.lastPrice);
            el.querySelector('.it-unit').value = rows[i].unit;
            el.querySelector('.it-price').value = rows[i].price;
            nameIn.blur();
          } else {
            el.querySelector('.it-unit').focus();
          }
          drawTotal();
        }, '새 물품으로 등록', (n) => {
          const info = itemInfo(n);
          return info && info.lastPrice ? ` <span class="muted small">· 최근 ${won(info.lastPrice)}${info.unit ? '/' + esc(info.unit) : ''}</span>` : '';
        });
      });
      drawTotal();
    };
    $('#itemRows').addEventListener('input', (e) => {
      const el = e.target.closest('.item-row'); if (!el) return;
      const it = rows[+el.dataset.i];
      if (e.target.classList.contains('it-name')) it.name = e.target.value;
      if (e.target.classList.contains('it-qty')) it.qty = e.target.value;
      if (e.target.classList.contains('it-unit')) it.unit = e.target.value;
      if (e.target.classList.contains('it-price')) it.price = e.target.value;
      drawTotal();
    });
    $('#itemRows').addEventListener('click', (e) => {
      const x = e.target.closest('.it-x'); if (!x) return;
      rows.splice(+x.closest('.item-row').dataset.i, 1);
      if (!rows.length) rows.push(blankItem());
      dirty = true; drawRows();
    });
    $('#addItem').addEventListener('click', () => {
      rows.push(blankItem());
      drawRows();
      $$('#itemRows .it-name').pop().focus();
    });
    drawRows();

    // 사진
    const drawPhotos = (g) => {
      const box = $(`.photos[data-g="${g}"]`);
      const thumb = (src, kind, i) => `<div class="ph"><img src="${esc(src)}" alt=""><button type="button" class="ph-x" data-kind="${kind}" data-i="${i}" aria-label="사진 빼기">×</button></div>`;
      box.innerHTML = ph[g].keep.map((p, i) => thumb(photoUrl(p, 300), 'keep', i)).join('')
        + ph[g].add.map((p, i) => thumb(p, 'add', i)).join('')
        + '<label class="ph-add"><input type="file" accept="image/*" capture="environment" hidden><b>📷</b>촬영</label>'
        + '<label class="ph-add"><input type="file" accept="image/*" multiple hidden><b>🖼</b>앨범</label>';
    };
    $$('.photos', f).forEach((box) => {
      const g = box.dataset.g;
      box.addEventListener('click', (e) => {
        const x = e.target.closest('.ph-x'); if (!x) return;
        ph[g][x.dataset.kind].splice(+x.dataset.i, 1);
        dirty = true; drawPhotos(g);
      });
      box.addEventListener('change', async (e) => {
        const files = [...(e.target.files || [])];
        if (!files.length) return;
        busy('사진 준비 중…');
        try {
          for (const file of files) ph[g].add.push(await compress(file));
        } catch (err) { toast(err.message, true); }
        busy(); dirty = true; drawPhotos(g);
      });
      drawPhotos(g);
    });

    // 저장
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const buy = r.type === '구매';
      const site = siteIn.value.replace(/\s+/g, ' ').trim();
      const vendor = vendorIn.value.replace(/\s+/g, ' ').trim();
      if (!f.date.value) { toast('날짜를 선택하세요', true); f.date.focus(); return; }
      if (!buy && !site) { toast('현장명을 입력하세요', true); siteIn.focus(); return; }
      const items = rows.map((it) => ({
        name: it.name.replace(/\s+/g, ' ').trim(), qty: num(it.qty) || 1, unit: it.unit.trim(), price: num(it.price),
      })).filter((it) => it.name);
      if (buy && !items.length) { toast('물품을 하나 이상 입력하세요', true); $('#itemRows .it-name').focus(); return; }
      const rec = buy
        ? { id: r.id, type: r.type, date: f.date.value, time: f.time.value, vendor, items, memo: f.memo.value.trim(), site: '', workers: [] }
        : {
          id: r.id, type: r.type, date: f.date.value, time: f.time.value, site, workers: [...picked],
          work: f.work.value.trim(), symptom: f.symptom.value.trim(), action: f.elements.action.value.trim(),
          result: r.result, resultMemo: f.resultMemo.value.trim(), materials: f.materials.value.trim(),
        };
      const groups = r.type === '공사' ? ['photosBefore', 'photosAfter'] : buy ? ['receipt'] : ['photos'];
      const total = groups.reduce((n, g) => n + ph[g].add.length, 0);
      const label = buy ? (vendor || '구매') : site;
      let done = 0;
      try {
        for (const g of groups) {
          while (ph[g].add.length) {
            busy(`사진 올리는 중 (${++done}/${total})`);
            const fid = await call('upload', { data: ph[g].add[0], name: `${rec.date}_${label}_${done}.jpg`, date: rec.date });
            ph[g].keep.push(fid);
            ph[g].add.shift();
          }
        }
        rec.photosBefore = r.type === '공사' ? ph.photosBefore.keep : [];
        rec.photosAfter = r.type === '공사' ? ph.photosAfter.keep : [];
        rec.photos = buy ? ph.receipt.keep : r.type === 'AS' ? ph.photos.keep : [];
        busy('저장 중…');
        const siteInfo = buy || isKnown(site) ? null : { address: f.ns_address.value.trim(), contact: f.ns_contact.value.trim(), phone: f.ns_phone.value.trim() };
        const res = await call('saveRecord', { record: rec, siteInfo });
        S.recs[res.record.id] = norm(res.record);
        S.monthKey = null;
        setMeta(res.meta);
        dirty = false;
        busy(); toast('저장했습니다');
        location.replace('#/view/' + res.record.id);
      } catch (err) {
        busy();
        groups.forEach(drawPhotos);
        toast(err.message, true);
      }
    });

    formGuard = () => dirty;
  }

  /* ───────── 관리 ───────── */
  async function pageAdmin() {
    if (!S.me.admin) { main.innerHTML = emptyHTML('관리자만 볼 수 있는 화면입니다.'); return; }
    main.innerHTML = loadingHTML;
    let U = await call('users');
    const draw = () => {
      main.innerHTML = `
        <div class="page-head"><h2 class="grow">관리</h2></div>
        <section class="panel">
          <h3 style="margin-top:0">사용자 <span class="muted small">로그인을 허용할 구글 계정</span></h3>
          <div class="mgr-list">
            <div class="mgr-row"><span class="name">${esc(U.owner)}</span><span class="tag gs">소유자 · 항상 관리자</span></div>
            ${U.users.map((u) => `<div class="mgr-row">
              <span class="name"><b>${esc(u.name)}</b><br><span class="muted small">${esc(u.email)}</span></span>
              ${u.admin ? '<span class="tag gs">관리자</span>' : ''}
              <button class="btn sm" data-act="toggleAdmin" data-v="${esc(u.email)}">${u.admin ? '관리자 해제' : '관리자 지정'}</button>
              <button class="btn sm danger" data-act="delUser" data-v="${esc(u.email)}">삭제</button></div>`).join('')}
          </div>
          <form class="inline-form" id="uf">
            <input type="email" name="email" placeholder="구글 이메일 (예: name@gmail.com)" required>
            <input name="name" placeholder="이름" required>
            <label class="check"><input type="checkbox" name="admin"> 관리자</label>
            <button class="btn primary">추가</button>
          </form>
        </section>
        <section class="panel">
          <h3 style="margin-top:0">현장 <span class="muted small">${S.sites.length}곳 · 삭제해도 기존 기록은 남습니다</span></h3>
          <div class="mgr-list">${S.sites.map((s) => `<div class="mgr-row">
            <span class="name">${esc(s.name)} <span class="muted small">${S.stats[s.name]?.count || 0}건</span></span>
            <button class="btn sm" data-act="renameSite" data-v="${esc(s.name)}">이름 변경</button>
            <button class="btn sm danger" data-act="delSite" data-v="${esc(s.name)}">삭제</button></div>`).join('') || '<p class="muted">없음</p>'}</div>
        </section>
        <section class="panel">
          <h3 style="margin-top:0">작업자 <span class="muted small">${S.workers.length}명 · 삭제해도 기존 기록은 남습니다</span></h3>
          <div class="mgr-list">${S.workers.map((w) => `<div class="mgr-row">
            <span class="name">${esc(w)}</span>
            <button class="btn sm" data-act="renameWorker" data-v="${esc(w)}">이름 변경</button>
            <button class="btn sm danger" data-act="delWorker" data-v="${esc(w)}">삭제</button></div>`).join('') || '<p class="muted">없음</p>'}</div>
        </section>
        <section class="panel">
          <h3 style="margin-top:0">물품 <span class="muted small">${S.items.length}개 · 삭제해도 기존 구매 기록은 남습니다</span></h3>
          <div class="mgr-list">${S.items.map((it) => `<div class="mgr-row">
            <span class="name">${esc(it.name)} <span class="muted small">${[it.unit, it.lastPrice ? '최근 ' + won(it.lastPrice) : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
            <button class="btn sm" data-act="renameItem" data-v="${esc(it.name)}">이름 변경</button>
            <button class="btn sm danger" data-act="delItem" data-v="${esc(it.name)}">삭제</button></div>`).join('') || '<p class="muted">없음 · 구매 기록에서 새 물품을 등록하면 여기에 쌓입니다</p>'}</div>
        </section>
        <section class="panel">
          <h3 style="margin-top:0">구매처 <span class="muted small">${S.vendors.length}곳 · 삭제해도 기존 구매 기록은 남습니다</span></h3>
          <div class="mgr-list">${S.vendors.map((v) => `<div class="mgr-row">
            <span class="name">${esc(v)}</span>
            <button class="btn sm" data-act="renameVendor" data-v="${esc(v)}">이름 변경</button>
            <button class="btn sm danger" data-act="delVendor" data-v="${esc(v)}">삭제</button></div>`).join('') || '<p class="muted">없음</p>'}</div>
        </section>`;
      $('#uf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        await run('추가 중…', async () => {
          U = await call('saveUser', { user: { email: f.elements.email.value.trim(), name: f.elements.name.value.trim(), admin: f.elements.admin.checked } });
        }, '사용자를 추가했습니다');
      });
    };
    const run = async (msg, fn, done) => {
      busy(msg);
      try { await fn(); busy(); if (done) toast(done); draw(); } catch (err) { busy(); toast(err.message, true); }
    };
    pageClick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const v = b.dataset.v;
      const act = b.dataset.act;
      if (act === 'toggleAdmin') {
        const u = U.users.find((x) => x.email === v);
        run('변경 중…', async () => { U = await call('saveUser', { user: { ...u, admin: !u.admin } }); });
      } else if (act === 'delUser') {
        if (confirm(`${v} 계정을 삭제할까요? 이 계정은 더 이상 로그인할 수 없습니다.`)) run('삭제 중…', async () => { U = await call('deleteUser', { email: v }); }, '삭제했습니다');
      } else if (['renameSite', 'renameWorker', 'renameItem', 'renameVendor'].includes(act)) {
        const nn = prompt(`'${v}'의 새 이름 (기존 기록도 함께 바뀝니다)`, v);
        if (nn && nn.trim() && nn.trim() !== v) {
          run('변경 중…', async () => { setMeta(await call(act, { name: v, newName: nn.trim() })); S.recs = {}; S.monthKey = null; }, '이름을 바꿨습니다');
        }
      } else if (act === 'delSite') {
        if (confirm(`현장 '${v}'을(를) 목록에서 삭제할까요?\n기존 기록은 남습니다.`)) run('삭제 중…', async () => { setMeta(await call('deleteSite', { name: v })); }, '삭제했습니다');
      } else if (act === 'delWorker') {
        if (confirm(`작업자 '${v}'을(를) 목록에서 삭제할까요?\n기존 기록은 남습니다.`)) run('삭제 중…', async () => { setMeta(await call('deleteWorker', { name: v })); }, '삭제했습니다');
      } else if (act === 'delItem') {
        if (confirm(`물품 '${v}'을(를) 목록에서 삭제할까요?\n기존 구매 기록은 남습니다.`)) run('삭제 중…', async () => { setMeta(await call('deleteItem', { name: v })); }, '삭제했습니다');
      } else if (act === 'delVendor') {
        if (confirm(`구매처 '${v}'을(를) 목록에서 삭제할까요?\n기존 구매 기록은 남습니다.`)) run('삭제 중…', async () => { setMeta(await call('deleteVendor', { name: v })); }, '삭제했습니다');
      }
    }
    draw();
  }

  /* ───────── 내 정보 ───────── */
  async function pageMe() {
    main.innerHTML = `
      <div class="page-head"><h2 class="grow">내 정보</h2></div>
      <section class="panel me-card">
        <div class="avatar">${esc(S.me.name.slice(0, 1))}</div>
        <div><b>${esc(S.me.name)}</b> ${S.me.admin ? '<span class="tag gs">관리자</span>' : ''}<br><span class="muted small">${esc(S.me.email)}</span></div>
      </section>
      <section class="panel menu">
        ${S.me.admin ? '<a href="#/admin">관리 (사용자·현장·작업자) <span>›</span></a>' : ''}
        <a href="#/sites">현장 목록 <span>›</span></a>
        ${DEMO ? '<a href="#" id="resetDemo">데모 데이터 초기화 <span>›</span></a>' : '<a href="#" id="logout">로그아웃 <span>›</span></a>'}
      </section>
      <p class="muted small" style="text-align:center">휴대폰 브라우저 메뉴에서 '홈 화면에 추가'를 누르면 앱처럼 쓸 수 있습니다.</p>`;
    $('#logout')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    $('#resetDemo')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('데모 데이터를 처음 상태로 되돌릴까요?')) { ls.del(DEMO_KEY); location.hash = '#/'; location.reload(); }
    });
  }

  /* ───────── 전역 이벤트 ───────── */
  let formGuard = null;
  let pageClick = null;
  main.addEventListener('click', (e) => {
    if (pageClick) pageClick(e);
    if (e.target.closest('[data-back]')) {
      if (history.length > 1) history.back(); else location.hash = '#/';
      return;
    }
    const img = e.target.closest('img[data-full]');
    if (img) { openLightbox(img.dataset.full); return; }
    if (e.target.closest('a, button, input, textarea, select, label')) return;
    const go = e.target.closest('[data-go]');
    if (go) location.hash = go.dataset.go;
  });

  function openLightbox(p) {
    const lb = $('#lightbox');
    $('img', lb).src = photoUrl(p, 2000);
    const open = $('#lbOpen');
    open.hidden = p.startsWith('data:');
    open.href = p.startsWith('data:') ? '#' : `https://drive.google.com/file/d/${encodeURIComponent(p)}/view`;
    lb.hidden = false;
  }
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lbOpen') return;
    $('#lightbox').hidden = true;
    $('#lightbox img').src = '';
  });

  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (formGuard && formGuard() && !confirm('저장하지 않은 내용이 있습니다. 이 화면을 나갈까요?')) {
      history.replaceState(null, '', lastHash || '#/');
      return;
    }
    formGuard = null;
    lastHash = location.hash;
    route();
  });
  window.addEventListener('beforeunload', (e) => {
    if (formGuard && formGuard()) { e.preventDefault(); e.returnValue = ''; }
  });
  matchMedia('(min-width: 960px)').addEventListener('change', () => { if (['', 'list'].includes(parseHash().page)) drawList(); });

  /* ───────── 시작 ───────── */
  function applyMe(me) {
    S.me = me;
    $$('[data-admin]').forEach((el) => { el.hidden = !S.me.admin; });
  }

  // 화면은 그대로 두고 최신 내용을 받아와 바꿔 끼운다 (기본 정보와 목록을 동시에 요청)
  async function refreshInBackground() {
    const rg = range();
    const wantList = S.period === 'recent';
    try {
      const [d, list] = await Promise.all([
        call('init'),
        wantList ? call('list', { from: rg.from, to: rg.to }) : null,
      ]);
      if (d.me.email !== S.me.email) { S.recs = {}; S.monthIds = []; S.monthKey = null; }
      applyMe(d.me);
      if (list && range().key === rg.key) {
        list.forEach((r) => { S.recs[r.id] = norm(r); });
        S.monthIds = list.map((r) => r.id);
        S.monthKey = rg.key;
      }
      S.refreshing = false;
      setMeta(d);
      if (onListPage()) drawList();
    } catch (e) {
      S.refreshing = false;
      if (onListPage()) drawList();
      toast(e.message, true);
    }
  }

  async function start() {
    if (DEMO) $('#demoBar').hidden = false;
    else if (!CFG.CLIENT_ID) {
      main.innerHTML = emptyHTML('config.js 에 CLIENT_ID 가 설정되지 않았습니다.');
      return;
    }
    const cache = DEMO ? null : ls.get(CACHE_KEY);
    if (cache && cache.me && cache.meta) {
      // 지난번 화면을 바로 보여주고, 뒤에서 최신 내용으로 바꾼다
      applyMe(cache.me);
      renderSide();
      S.sites = cache.meta.sites; S.workers = cache.meta.workers; S.stats = cache.meta.stats;
      S.items = cache.meta.items || []; S.vendors = cache.meta.vendors || [];
      drawSideList();
      if (cache.recs && S.period === 'recent') {
        cache.recs.forEach((r) => { S.recs[r.id] = norm(r); });
        S.monthIds = cache.recs.map((r) => r.id);
        S.monthKey = range().key;
      }
      S.refreshing = true;
      route();
      refreshInBackground();
      return;
    }
    try {
      // 처음 쓰는 기기: 기본 정보와 목록을 동시에 요청
      const [d] = await Promise.all([
        call('init'),
        onListPage() ? loadMonth().catch(() => {}) : null,
      ]);
      applyMe(d.me);
      renderSide();
      setMeta(d);
    } catch (e) {
      main.innerHTML = emptyHTML(e.message, '<br><button class="btn" onclick="location.reload()">다시 시도</button>');
      return;
    }
    route();
  }
  start();
})();
