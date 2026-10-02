/**
 * 파이텍 공사·A/S 기록 — 서버 (Google Apps Script)
 *
 * 구글 시트에서 [확장 프로그램 → Apps Script]를 열고 이 파일 내용을 그대로 붙여넣으세요.
 * 자세한 순서는 설치안내.md 를 보세요.
 */

// ▼ Google Cloud에서 만든 OAuth 클라이언트 ID (config.js 의 CLIENT_ID 와 같은 값)
const CLIENT_ID = '946616118272-r8362dqila97ddvogtae425rifug1b01.apps.googleusercontent.com';

const TZ = 'Asia/Seoul';
const PHOTO_FOLDER_NAME = '파이텍 기록 사진';
const RESULTS = ['정상', '관찰 필요', '재방문'];

const TABLES = {
  records: {
    name: '기록',
    cols: [
      ['id', 'ID'], ['type', '구분'], ['date', '날짜'], ['time', '시간'], ['site', '현장'],
      ['workers', '작업자'], ['work', '작업내용'], ['symptom', '증상'], ['action', '조치'],
      ['result', '조치후상태'], ['resultMemo', '상태메모'], ['materials', '사용자재'],
      ['photosBefore', '작업전사진'], ['photosAfter', '작업후사진'], ['photos', '사진'],
      ['author', '작성자'], ['authorEmail', '작성자이메일'], ['createdAt', '작성일시'], ['updatedAt', '수정일시'],
      // 구매용 칸 (기존 칸 뒤에 덧붙임 — 기존 기록 위치는 그대로)
      ['vendor', '구매처'], ['items', '구매물품'], ['total', '구매금액'], ['memo', '메모'],
    ],
  },
  sites: {
    name: '현장',
    cols: [['name', '현장명'], ['address', '주소'], ['contact', '담당자'], ['phone', '연락처'], ['createdBy', '등록자'], ['createdAt', '등록일시']],
  },
  workers: {
    name: '작업자',
    cols: [['name', '이름'], ['createdBy', '등록자'], ['createdAt', '등록일시']],
  },
  items: {
    name: '물품',
    cols: [['name', '물품명'], ['unit', '단위'], ['lastPrice', '최근단가'], ['createdBy', '등록자'], ['createdAt', '등록일시'], ['vat', '부가세']],
  },
  vendors: {
    name: '구매처',
    cols: [['name', '구매처명'], ['createdBy', '등록자'], ['createdAt', '등록일시']],
  },
  users: {
    name: '사용자',
    cols: [['email', '이메일'], ['name', '이름'], ['admin', '관리자'], ['createdAt', '등록일시']],
  },
};

/* ───────── 최초 1회 실행: 시트·사진 폴더 만들기 ───────── */
function setup() {
  Object.keys(TABLES).forEach(sheetOf);
  photoRoot();
  Logger.log('준비 완료. 소유자(관리자): ' + ownerEmail());
}

/* ───────── 요청 처리 ───────── */
function doGet() {
  return ContentService.createTextOutput('파이텍 기록 서버가 동작 중입니다.');
}

function doPost(e) {
  let p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: '잘못된 요청입니다.' });
  }
  try {
    const me = authenticate(p.token);
    const fn = ACTIONS[p.action];
    if (!fn) throw fail('알 수 없는 요청입니다: ' + p.action);
    return out({ ok: true, data: fn(p, me) });
  } catch (err) {
    return out({ ok: false, error: err.message || String(err), code: err.code || '', email: err.email || '' });
  }
}

const ACTIONS = {
  init: (p, me) => Object.assign({ me: { email: me.email, name: me.name, admin: me.admin } }, meta()),
  list: (p) => records().filter((r) => r.date >= p.from && r.date <= p.to),
  site: (p) => records().filter((r) => r.site === p.name),
  get: (p) => {
    const r = records().find((x) => x.id === p.id);
    if (!r) throw fail('기록을 찾을 수 없습니다. 삭제되었을 수 있습니다.');
    return r;
  },
  upload: (p) => uploadPhoto(p.data, p.name, p.date),
  saveRecord: (p, me) => withLock(() => saveRecord(p.record, p.siteInfo, me)),
  deleteRecord: (p, me) => withLock(() => deleteRecord(p.id, me)),

  addSite: (p, me) => withLock(() => { ensureSite(clean(p.name), p.info, me); return meta(); }),
  updateSite: (p) => withLock(() => updateSite(p.site)),
  renameSite: (p, me) => { needAdmin(me); return withLock(() => renameSite(p.name, p.newName)); },
  deleteSite: (p, me) => { needAdmin(me); return withLock(() => { deleteWhere('sites', 'name', p.name); return meta(); }); },

  addWorker: (p, me) => withLock(() => { ensureWorker(cleanName(p.name), me); return meta(); }),
  renameWorker: (p, me) => { needAdmin(me); return withLock(() => renameWorker(p.name, p.newName)); },
  deleteWorker: (p, me) => { needAdmin(me); return withLock(() => { deleteWhere('workers', 'name', p.name); return meta(); }); },

  renameItem: (p, me) => { needAdmin(me); return withLock(() => renameItem(p.name, p.newName)); },
  deleteItem: (p, me) => { needAdmin(me); return withLock(() => { deleteWhere('items', 'name', p.name); return meta(); }); },
  renameVendor: (p, me) => { needAdmin(me); return withLock(() => renameVendor(p.name, p.newName)); },
  deleteVendor: (p, me) => { needAdmin(me); return withLock(() => { deleteWhere('vendors', 'name', p.name); return meta(); }); },

  users: (p, me) => { needAdmin(me); return usersOut(); },
  saveUser: (p, me) => { needAdmin(me); return withLock(() => saveUser(p.user)); },
  deleteUser: (p, me) => { needAdmin(me); return withLock(() => { deleteWhere('users', 'email', String(p.email || '').toLowerCase()); return usersOut(); }); },
};

/* ───────── 로그인 확인 ───────── */
function authenticate(token) {
  if (!token) throw fail('로그인이 필요합니다.', 'AUTH');
  const ident = verifyToken(token);
  const owner = ownerEmail();
  const u = readAll('users').find((x) => x.email.toLowerCase() === ident.email);
  if (ident.email === owner) {
    return { email: ident.email, name: (u && u.name) || ident.name || '관리자', admin: true };
  }
  if (!u) throw fail('등록되지 않은 계정입니다.', 'DENIED', { email: ident.email });
  return { email: ident.email, name: u.name || ident.name, admin: u.admin === 'Y' };
}

function verifyToken(token) {
  if (CLIENT_ID.indexOf('여기에') === 0) throw fail('서버 설정이 끝나지 않았습니다 (CLIENT_ID).');
  const cache = CacheService.getScriptCache();
  const key = 'tk_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 43);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw fail('로그인이 만료되었습니다.', 'AUTH');
  const info = JSON.parse(res.getContentText());
  const exp = Number(info.exp) * 1000;
  const issOk = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (info.aud !== CLIENT_ID || !issOk || !verified || !info.email || exp < Date.now()) {
    throw fail('로그인 정보가 올바르지 않습니다.', 'AUTH');
  }
  const ident = { email: String(info.email).toLowerCase(), name: info.name || '' };
  const ttl = Math.floor((exp - Date.now()) / 1000) - 30;
  if (ttl > 60) cache.put(key, JSON.stringify(ident), Math.min(ttl, 3600));
  return ident;
}

function ownerEmail() {
  return Session.getEffectiveUser().getEmail().toLowerCase();
}

function needAdmin(me) {
  if (!me.admin) throw fail('관리자만 할 수 있습니다.');
}

/* ───────── 기록 ───────── */
function records() {
  return readAll('records').filter((r) => r.id).map(recOut);
}

function recOut(r) {
  return {
    id: r.id, type: r.type === 'AS' || r.type === '구매' ? r.type : '공사', date: r.date, time: r.time, site: r.site,
    vendor: r.vendor || '', items: parseItems(r.items), total: Number(r.total) || 0, memo: r.memo || '',
    workers: splitList(r.workers), work: r.work, symptom: r.symptom, action: r.action,
    result: r.result, resultMemo: r.resultMemo, materials: r.materials,
    photosBefore: splitList(r.photosBefore), photosAfter: splitList(r.photosAfter), photos: splitList(r.photos),
    author: r.author, authorEmail: r.authorEmail, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function saveRecord(rec, siteInfo, me) {
  if (!rec) throw fail('저장할 내용이 없습니다.');
  const type = rec.type === 'AS' || rec.type === '구매' ? rec.type : '공사';
  const buy = type === '구매';
  const date = String(rec.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail('날짜가 올바르지 않습니다.');
  const site = buy ? '' : clean(rec.site);
  if (!buy && !site) throw fail('현장명을 입력하세요.');
  const workers = buy ? [] : (rec.workers || []).map(cleanName).filter(Boolean);
  const vendor = buy ? clean(rec.vendor) : '';
  const items = buy ? cleanItems(rec.items) : [];
  if (buy && !items.length) throw fail('물품을 하나 이상 입력하세요.');

  if (buy) {
    if (vendor) ensureVendor(vendor, me);
    items.forEach((it) => ensureItem(it, me));
  } else {
    ensureSite(site, siteInfo, me);
    workers.forEach((w) => ensureWorker(w, me));
  }

  const row = {
    type, date, site,
    time: /^\d{2}:\d{2}$/.test(rec.time) ? rec.time : '',
    workers: workers.join(', '),
    work: type === '공사' ? text(rec.work) : '',
    symptom: type === 'AS' ? text(rec.symptom) : '',
    action: type === 'AS' ? text(rec.action) : '',
    result: type === 'AS' && RESULTS.indexOf(rec.result) >= 0 ? rec.result : '',
    resultMemo: type === 'AS' ? text(rec.resultMemo) : '',
    materials: buy ? '' : text(rec.materials),
    photosBefore: type === '공사' ? photoIds(rec.photosBefore) : '',
    photosAfter: type === '공사' ? photoIds(rec.photosAfter) : '',
    photos: type === 'AS' || buy ? photoIds(rec.photos) : '',
    vendor,
    items: items.length ? JSON.stringify(items) : '',
    total: buy ? String(items.reduce((t, it) => t + lineTotal(it), 0)) : '',
    memo: buy ? text(rec.memo) : '',
    updatedAt: stamp(),
  };

  if (rec.id) {
    const old = readAll('records').find((x) => x.id === rec.id);
    if (!old) throw fail('기록을 찾을 수 없습니다. 삭제되었을 수 있습니다.');
    Object.assign(row, { id: old.id, author: old.author, authorEmail: old.authorEmail, createdAt: old.createdAt });
    writeRow('records', old._row, row);
    const keep = allPhotos(row);
    trashPhotos(allPhotos(old).filter((id) => keep.indexOf(id) < 0));
  } else {
    Object.assign(row, { id: newId(), author: me.name, authorEmail: me.email, createdAt: row.updatedAt });
    writeRow('records', 0, row);
  }
  return { record: recOut(row), meta: meta() };
}

function deleteRecord(id, me) {
  const old = readAll('records').find((x) => x.id === id);
  if (!old) throw fail('기록을 찾을 수 없습니다.');
  if (!me.admin && old.authorEmail !== me.email) throw fail('작성자 본인이나 관리자만 삭제할 수 있습니다.');
  sheetOf('records').deleteRow(old._row);
  trashPhotos(allPhotos(old));
  return meta();
}

function allPhotos(r) {
  return [].concat(splitList(r.photosBefore), splitList(r.photosAfter), splitList(r.photos));
}

function photoIds(list) {
  return (list || []).map(String).filter((x) => /^[\w-]{10,}$/.test(x)).join(',');
}

/* ───────── 현장·작업자·사용자 ───────── */
function meta() {
  const stats = {};
  records().forEach((r) => {
    if (!r.site) return;
    const s = stats[r.site] || (stats[r.site] = { count: 0, last: '' });
    s.count++;
    if (r.date > s.last) s.last = r.date;
  });
  const sites = readAll('sites').map((s) => ({ name: s.name, address: s.address, contact: s.contact, phone: s.phone }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const workers = readAll('workers').map((w) => w.name).sort((a, b) => a.localeCompare(b, 'ko'));
  const items = readAll('items').map((i) => ({ name: i.name, unit: i.unit, lastPrice: Number(i.lastPrice) || 0, vat: i.vat || '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const vendors = readAll('vendors').map((v) => v.name).sort((a, b) => a.localeCompare(b, 'ko'));
  return { sites, workers, stats, items, vendors };
}

function ensureSite(name, info, me) {
  if (!name) throw fail('현장명을 입력하세요.');
  if (readAll('sites').some((s) => s.name === name)) return;
  info = info || {};
  writeRow('sites', 0, {
    name, address: clean(info.address), contact: clean(info.contact), phone: clean(info.phone),
    createdBy: me.name, createdAt: stamp(),
  });
}

function updateSite(site) {
  const s = readAll('sites').find((x) => x.name === (site && site.name));
  if (!s) throw fail('현장을 찾을 수 없습니다.');
  s.address = clean(site.address);
  s.contact = clean(site.contact);
  s.phone = clean(site.phone);
  writeRow('sites', s._row, s);
  return meta();
}

function renameSite(name, newName) {
  newName = clean(newName);
  if (!newName) throw fail('새 현장명을 입력하세요.');
  const sites = readAll('sites');
  const s = sites.find((x) => x.name === name);
  if (!s) throw fail('현장을 찾을 수 없습니다.');
  if (newName !== name && sites.some((x) => x.name === newName)) throw fail('같은 이름의 현장이 이미 있습니다.');
  s.name = newName;
  writeRow('sites', s._row, s);
  updateColumn('records', 'site', (v) => (v === name ? newName : v));
  return meta();
}

function ensureWorker(name, me) {
  if (!name) throw fail('작업자 이름을 입력하세요.');
  if (readAll('workers').some((w) => w.name === name)) return;
  writeRow('workers', 0, { name, createdBy: me.name, createdAt: stamp() });
}

function renameWorker(name, newName) {
  newName = cleanName(newName);
  if (!newName) throw fail('새 이름을 입력하세요.');
  const list = readAll('workers');
  const w = list.find((x) => x.name === name);
  if (!w) throw fail('작업자를 찾을 수 없습니다.');
  if (newName !== name && list.some((x) => x.name === newName)) throw fail('같은 이름의 작업자가 이미 있습니다.');
  w.name = newName;
  writeRow('workers', w._row, w);
  updateColumn('records', 'workers', (v) => splitList(v).map((x) => (x === name ? newName : x)).join(', '));
  return meta();
}

/* ───────── 구매: 물품·구매처 ───────── */
function parseItems(v) {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function cleanItems(list) {
  return (list || []).map((it) => ({
    name: cleanName(it && it.name),
    qty: Math.max(0, Number(it && it.qty) || 0) || 1,
    unit: clean(it && it.unit).slice(0, 10),
    price: Math.max(0, Math.round(Number(it && it.price) || 0)),
    vat: it && (it.vat === '별도' || it.vat === '포함') ? it.vat : '',
  })).filter((it) => it.name).slice(0, 100);
}

// 부가세: '' = 선택 안 함, '별도' = 공급가액의 10% 추가, '포함' = 공급가액 안에 든 부가세(÷11)
function lineTotal(it) {
  const supply = Math.round(it.qty * it.price);
  return it.vat === '별도' ? supply + Math.round(supply * 0.1) : supply;
}

function ensureItem(it, me) {
  const row = readAll('items').find((x) => x.name === it.name);
  if (row) {
    let changed = false;
    if (it.unit && it.unit !== row.unit) { row.unit = it.unit; changed = true; }
    if (it.price && String(it.price) !== row.lastPrice) { row.lastPrice = String(it.price); changed = true; }
    if ((it.vat || '') !== (row.vat || '')) { row.vat = it.vat || ''; changed = true; }
    if (changed) writeRow('items', row._row, row);
    return;
  }
  writeRow('items', 0, { name: it.name, unit: it.unit, lastPrice: it.price ? String(it.price) : '', createdBy: me.name, createdAt: stamp(), vat: it.vat || '' });
}

function ensureVendor(name, me) {
  if (readAll('vendors').some((v) => v.name === name)) return;
  writeRow('vendors', 0, { name, createdBy: me.name, createdAt: stamp() });
}

function renameItem(name, newName) {
  newName = cleanName(newName);
  if (!newName) throw fail('새 이름을 입력하세요.');
  const list = readAll('items');
  const it = list.find((x) => x.name === name);
  if (!it) throw fail('물품을 찾을 수 없습니다.');
  if (newName !== name && list.some((x) => x.name === newName)) throw fail('같은 이름의 물품이 이미 있습니다.');
  it.name = newName;
  writeRow('items', it._row, it);
  updateColumn('records', 'items', (v) => {
    if (!v) return v;
    const arr = parseItems(v);
    let hit = false;
    arr.forEach((x) => { if (x.name === name) { x.name = newName; hit = true; } });
    return hit ? JSON.stringify(arr) : v;
  });
  return meta();
}

function renameVendor(name, newName) {
  newName = clean(newName);
  if (!newName) throw fail('새 이름을 입력하세요.');
  const list = readAll('vendors');
  const v = list.find((x) => x.name === name);
  if (!v) throw fail('구매처를 찾을 수 없습니다.');
  if (newName !== name && list.some((x) => x.name === newName)) throw fail('같은 이름의 구매처가 이미 있습니다.');
  v.name = newName;
  writeRow('vendors', v._row, v);
  updateColumn('records', 'vendor', (x) => (x === name ? newName : x));
  return meta();
}

function usersOut() {
  return {
    owner: ownerEmail(),
    users: readAll('users').map((u) => ({ email: u.email, name: u.name, admin: u.admin === 'Y' })),
  };
}

function saveUser(user) {
  const email = String((user && user.email) || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('이메일 주소가 올바르지 않습니다.');
  const name = cleanName(user.name);
  if (!name) throw fail('이름을 입력하세요.');
  const u = readAll('users').find((x) => x.email.toLowerCase() === email);
  const row = { email, name, admin: user.admin ? 'Y' : '', createdAt: u ? u.createdAt : stamp() };
  writeRow('users', u ? u._row : 0, row);
  return usersOut();
}

/* ───────── 사진 (구글 드라이브) ───────── */
function uploadPhoto(data, name, date) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(String(data || ''));
  if (!m) throw fail('사진 형식이 올바르지 않습니다.');
  const bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 10 * 1024 * 1024) throw fail('사진 용량이 너무 큽니다.');
  const month = /^\d{4}-\d{2}/.test(String(date)) ? String(date).slice(0, 7) : Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  const file = monthFolder(month).createFile(Utilities.newBlob(bytes, 'image/' + m[1], clean(name) || 'photo.jpg'));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

function photoRoot() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_ROOT');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* 폴더가 없어졌으면 새로 만든다 */ }
  }
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_ROOT', folder.getId());
  return folder;
}

function monthFolder(month) {
  const root = photoRoot();
  const it = root.getFoldersByName(month);
  return it.hasNext() ? it.next() : root.createFolder(month);
}

// 사진 폴더 안의 파일만 휴지통으로 보낸다 (다른 드라이브 파일은 건드리지 않음)
function trashPhotos(ids) {
  if (!ids.length) return;
  const rootId = photoRoot().getId();
  ids.forEach((id) => {
    try {
      const file = DriveApp.getFileById(id);
      const parents = file.getParents();
      while (parents.hasNext()) {
        const folder = parents.next();
        const up = folder.getParents();
        if (folder.getId() === rootId || (up.hasNext() && up.next().getId() === rootId)) {
          file.setTrashed(true);
          return;
        }
      }
    } catch (e) { /* 이미 없는 파일은 무시 */ }
  });
}

/* ───────── 시트 읽기·쓰기 ───────── */
function sheetOf(t) {
  const def = TABLES[t];
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols.map((c) => c[1])]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 날짜·전화번호가 자동 변환되지 않도록 전부 '일반 텍스트'로
    sh.getRange(1, 1, sh.getMaxRows(), def.cols.length).setNumberFormat('@');
  } else if (sh.getLastColumn() < def.cols.length) {
    // 예전에 만든 시트에 새 칸이 생기면 제목만 덧붙인다 (기존 내용은 그대로)
    const start = sh.getLastColumn() + 1;
    const extra = def.cols.slice(start - 1);
    if (sh.getMaxColumns() < def.cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), def.cols.length - sh.getMaxColumns());
    sh.getRange(1, start, sh.getMaxRows(), extra.length).setNumberFormat('@');
    sh.getRange(1, start, 1, extra.length).setValues([extra.map((c) => c[1])]).setFontWeight('bold');
  }
  return sh;
}

function readAll(t) {
  const def = TABLES[t];
  const sh = sheetOf(t);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, def.cols.length).getValues().map((row, i) => {
    const o = { _row: i + 2 };
    def.cols.forEach((c, j) => { o[c[0]] = cellStr(row[j]); });
    return o;
  });
}

function writeRow(t, rowNum, obj) {
  const def = TABLES[t];
  const sh = sheetOf(t);
  if (!rowNum) {
    rowNum = sh.getLastRow() + 1;
    if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  }
  sh.getRange(rowNum, 1, 1, def.cols.length)
    .setNumberFormat('@')
    .setValues([def.cols.map((c) => cellSafe(obj[c[0]]))]);
}

function updateColumn(t, key, fn) {
  const def = TABLES[t];
  const sh = sheetOf(t);
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const col = def.cols.findIndex((c) => c[0] === key) + 1;
  const range = sh.getRange(2, col, n, 1);
  range.setValues(range.getValues().map((r) => [cellSafe(fn(cellStr(r[0])))]));
}

function deleteWhere(t, key, value) {
  const row = readAll(t).find((x) => x[key] === value);
  if (!row) throw fail('항목을 찾을 수 없습니다.');
  sheetOf(t).deleteRow(row._row);
}

function cellStr(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, TZ, v.getFullYear() < 1900 ? 'HH:mm' : 'yyyy-MM-dd');
  }
  const s = v == null ? '' : String(v);
  return s.indexOf("'=") === 0 ? s.slice(1) : s;
}

// '=' 로 시작하는 글은 수식으로 실행되지 않게 막는다
function cellSafe(v) {
  const s = v == null ? '' : String(v);
  return s.charAt(0) === '=' ? "'" + s : s;
}

/* ───────── 기타 ───────── */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 200); }
function cleanName(v) { return clean(v).replace(/,/g, ' ').trim().slice(0, 40); }
function text(v) { return String(v == null ? '' : v).trim().slice(0, 5000); }
function splitList(v) { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }
function stamp() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function newId() { return Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + Utilities.getUuid().slice(0, 4); }

function fail(message, code, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
