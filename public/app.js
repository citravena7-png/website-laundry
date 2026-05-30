// ============================================================
// FIREBASE INIT
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyAYz3zTyAeKeoprTHd-vPiIoqA5AKtgfsE",
  authDomain: "laundry-fcd7b.firebaseapp.com",
  projectId: "laundry-fcd7b",
  storageBucket: "laundry-fcd7b.firebasestorage.app",
  messagingSenderId: "997160617517",
  appId: "1:997160617517:web:0feac28b2422701141daa4",
  measurementId: "G-VEJ7L5SY25"
};

firebase.initializeApp(firebaseConfig);
const AUTH  = firebase.auth();
const DB_FS = firebase.firestore();

// ============================================================
// DAFTAR LAYANAN DEFAULT
// flat  = harga tetap per paket (misal 15000/7kg)
// per_kg = harga dihitung × berat
// ============================================================
const DEFAULT_SERVICES = [
  { id: 's1', name: 'Cuci Kering',        price: 15000, type: 'flat',   flatKg: 7, duration: '2-3 hari', description: 'Rp 15.000 per 7 kg (paket flat)', active: true },
  { id: 's2', name: 'Paket Cuci Basah',   price: 10000, type: 'flat',   flatKg: 8, duration: '2-3 hari', description: 'Rp 10.000 per 8 kg (paket flat)', active: true },
  { id: 's3', name: 'Paket Cuci Lipat',   price: 20000, type: 'flat',   flatKg: 7, duration: '2-3 hari', description: 'Rp 20.000 per 7 kg (paket flat)', active: true },
  { id: 's4', name: 'Paket Cuci Setrika', price: 5500,  type: 'per_kg', flatKg: 0, duration: '2-3 hari', description: 'Rp 5.500 per kg',                 active: true },
  { id: 's5', name: 'Paket Setrika Aja',  price: 4000,  type: 'per_kg', flatKg: 0, duration: '1-2 hari', description: 'Rp 4.000 per kg',                 active: true }
];

// ============================================================
// LOCAL STORAGE
// ============================================================
const LS = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};

let DB = {
  orders:    LS.get('ld_orders')    || [],
  customers: LS.get('ld_customers') || [],
  services:  LS.get('ld_services')  || [],
  settings:  LS.get('ld_settings')  || {}
};

let currentUser    = null;
let editOrderId    = null;
let editCustId     = null;
let editSvcId      = null;
let cashierOrderId = null;
let detailOrderId  = null;

// ============================================================
// HITUNG TOTAL — logika flat vs per_kg
// ============================================================
function calcTotal(svc, kg) {
  if (!svc || !kg) return 0;
  if (svc.type === 'flat') {
    // bulatkan ke atas per paket
    return svc.price * Math.ceil(kg / svc.flatKg);
  }
  return svc.price * kg;
}

function svcLabel(svc) {
  if (svc.type === 'flat') return `${svc.name} (Rp ${svc.price.toLocaleString('id-ID')}/${svc.flatKg}kg)`;
  return `${svc.name} (Rp ${svc.price.toLocaleString('id-ID')}/kg)`;
}

// ============================================================
// PERSIST & FIRESTORE SYNC
// ============================================================
function persist() {
  LS.set('ld_orders',    DB.orders);
  LS.set('ld_customers', DB.customers);
  LS.set('ld_services',  DB.services);
  LS.set('ld_settings',  DB.settings);

  if (DB_FS) {
    DB.orders.forEach(o    => DB_FS.collection('orders').doc(String(o.id)).set(o).catch(() => {}));
    DB.customers.forEach(c => DB_FS.collection('customers').doc(String(c.id)).set(c).catch(() => {}));
    DB.services.forEach(s  => DB_FS.collection('services').doc(String(s.id)).set(s).catch(() => {}));
    if (Object.keys(DB.settings).length) {
      DB_FS.collection('settings').doc('main').set(DB.settings).catch(() => {});
    }
  }
}

async function loadFromFirestore() {
  try {
    const [o, c, s, st] = await Promise.all([
      DB_FS.collection('orders').get(),
      DB_FS.collection('customers').get(),
      DB_FS.collection('services').get(),
      DB_FS.collection('settings').doc('main').get()
    ]);
    if (!o.empty)  DB.orders    = o.docs.map(d => d.data());
    if (!c.empty)  DB.customers = c.docs.map(d => d.data());
    if (!s.empty)  DB.services  = s.docs.map(d => d.data());
    if (st.exists) DB.settings  = st.data();
    LS.set('ld_orders',    DB.orders);
    LS.set('ld_customers', DB.customers);
    LS.set('ld_services',  DB.services);
    LS.set('ld_settings',  DB.settings);
  } catch (e) {
    console.warn('Firestore load error:', e);
  }
}

function setupRealtimeListeners() {
  DB_FS.collection('orders').onSnapshot(snap => {
    DB.orders = snap.docs.map(d => d.data());
    LS.set('ld_orders', DB.orders);
    refreshAll();
  });
  DB_FS.collection('customers').onSnapshot(snap => {
    DB.customers = snap.docs.map(d => d.data());
    LS.set('ld_customers', DB.customers);
    renderCustomers();
  });
  DB_FS.collection('services').onSnapshot(snap => {
    DB.services = snap.docs.map(d => d.data());
    LS.set('ld_services', DB.services);
    renderServices();
  });
}

// Seed layanan default jika kosong
function seedServices() {
  if (DB.services.length === 0) {
    DB.services = DEFAULT_SERVICES.map(s => ({ ...s }));
    persist();
  }
}

// ============================================================
// HELPERS
// ============================================================
function rp(n) { return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID'); }

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

const STATUS_CFG = {
  'Diterima':    { cls: 'b-red' },
  'Dicuci':      { cls: 'b-amber' },
  'Dikeringkan': { cls: 'b-blue' },
  'Disetrika':   { cls: 'b-violet' },
  'Siap Ambil':  { cls: 'b-green' },
  'Selesai':     { cls: 'b-gray' }
};

function badge(status) {
  const cfg = STATUS_CFG[status] || { cls: 'b-gray' };
  return `<span class="badge ${cfg.cls}">${status}</span>`;
}

// ============================================================
// MODAL HELPERS
// ============================================================
function modalOpen(id)  { document.getElementById(id).classList.add('open'); }
function modalClose(id) { document.getElementById(id).classList.remove('open'); }

document.querySelectorAll('.overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(m => m.classList.remove('open'));
});

// ============================================================
// TOAST
// ============================================================
const TOAST_ICONS = {
  ok:  `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
  err: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  inf: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
};

function toast(msg, type = 'inf') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `${TOAST_ICONS[type] || ''}<span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ============================================================
// AUTH
// ============================================================
AUTH.onAuthStateChanged(user => {
  if (user && !currentUser) {
    currentUser = { name: user.displayName || user.email.split('@')[0], email: user.email, role: 'Administrator', uid: user.uid };
    enterApp();
  }
});

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  const errEl = document.getElementById('auth-err');
  errEl.style.display = 'none';

  if (!email || !pass) { errEl.textContent = 'Email dan kata sandi wajib diisi.'; errEl.style.display = 'block'; return; }

  const btn = document.getElementById('btn-login');
  btn.textContent = 'Masuk...'; btn.disabled = true;

  try {
    const r = await AUTH.signInWithEmailAndPassword(email, pass);
    currentUser = { name: r.user.displayName || email.split('@')[0], email: r.user.email, role: 'Administrator', uid: r.user.uid };
    enterApp();
  } catch (e) {
    const msgs = {
      'auth/invalid-credential':   'Email atau kata sandi salah.',
      'auth/invalid-login-credentials': 'Email atau kata sandi salah.',
      'auth/user-not-found':       'Akun tidak ditemukan.',
      'auth/wrong-password':       'Kata sandi salah.',
      'auth/invalid-email':        'Format email tidak valid.',
      'auth/too-many-requests':    'Terlalu banyak percobaan. Coba lagi nanti.'
    };
    errEl.textContent = msgs[e.code] || ('Login gagal: ' + e.message);
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Masuk'; btn.disabled = false;
  }
});

async function enterApp() {
  document.getElementById('auth').style.display = 'none';
  document.getElementById('sidebar').classList.add('show');
  document.getElementById('main').classList.add('show');
  document.getElementById('sb-name').textContent = currentUser.name;
  document.getElementById('sb-av').textContent   = currentUser.name[0].toUpperCase();
  document.getElementById('sb-role').textContent = currentUser.role;

  toast('Memuat data...', 'inf');
  await loadFromFirestore();
  seedServices();
  setupRealtimeListeners();
  refreshAll();
  toast('Selamat datang, ' + currentUser.name + '!', 'ok');
}

document.getElementById('btn-logout').addEventListener('click', () => modalOpen('m-logout'));
document.getElementById('m-logout-close').addEventListener('click',   () => modalClose('m-logout'));
document.getElementById('m-logout-cancel').addEventListener('click',  () => modalClose('m-logout'));
document.getElementById('m-logout-confirm').addEventListener('click', async () => {
  try { await AUTH.signOut(); } catch (e) {}
  currentUser = null;
  modalClose('m-logout');
  document.getElementById('sidebar').classList.remove('show');
  document.getElementById('main').classList.remove('show');
  document.getElementById('auth').style.display = 'flex';
  toast('Sampai jumpa!', 'inf');
});

// ============================================================
// NAVIGATION
// ============================================================
const PAGE_CFG = {
  dashboard: { title: 'Dashboard',         action: '+ Tambah Pesanan',   fn: () => openOrderModal() },
  orders:    { title: 'Manajemen Pesanan', action: '+ Tambah Pesanan',   fn: () => openOrderModal() },
  customers: { title: 'Data Pelanggan',    action: '+ Tambah Pelanggan', fn: () => openCustModal() },
  services:  { title: 'Layanan & Harga',   action: '+ Tambah Layanan',   fn: () => openSvcModal() },
  cashier:   { title: 'Kasir',             action: 'Segarkan',           fn: () => renderCashier() },
  reports:   { title: 'Laporan',           action: 'Cetak',              fn: () => window.print() },
  settings:  { title: 'Pengaturan',        action: 'Simpan',             fn: () => saveSettings() }
};

let curPage = 'dashboard';

function nav(page) {
  curPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.sb-btn').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('nav-' + page);
  if (nb) nb.classList.add('active');
  const cfg = PAGE_CFG[page] || {};
  document.getElementById('page-title').textContent      = cfg.title || page;
  document.getElementById('btn-main-action').textContent = cfg.action || '';
  renderPage(page);
}

function renderPage(page) {
  if      (page === 'dashboard') renderDashboard();
  else if (page === 'orders')    renderOrders();
  else if (page === 'customers') renderCustomers();
  else if (page === 'services')  renderServices();
  else if (page === 'cashier')   renderCashier();
  else if (page === 'reports')   renderReports();
  else if (page === 'settings')  loadSettings();
}

function refreshAll() { renderPage(curPage); updateBadges(); }

document.querySelectorAll('.sb-btn[data-page]').forEach(btn => btn.addEventListener('click', () => nav(btn.dataset.page)));
document.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => nav(el.dataset.nav)));
document.getElementById('btn-main-action').addEventListener('click', () => { const cfg = PAGE_CFG[curPage]; if (cfg && cfg.fn) cfg.fn(); });
document.getElementById('btn-refresh').addEventListener('click', refreshAll);

// ============================================================
// BADGES
// ============================================================
function updateBadges() {
  const active = DB.orders.filter(o => o.status !== 'Selesai').length;
  const ready  = DB.orders.filter(o => o.status === 'Siap Ambil').length;
  const badgeO = document.getElementById('badge-orders');
  const badgeC = document.getElementById('badge-cashier');
  badgeO.textContent = active; badgeO.style.display = active ? '' : 'none';
  badgeC.textContent = ready;  badgeC.style.display = ready  ? '' : 'none';
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const done       = DB.orders.filter(o => o.status === 'Selesai');
  const doneMonth  = done.filter(o => (o.completedAt || o.created) >= monthStart);
  const rev        = doneMonth.reduce((s, o) => s + (o.total || 0), 0);
  const active     = DB.orders.filter(o => o.status !== 'Selesai').length;
  const ready      = DB.orders.filter(o => o.status === 'Siap Ambil').length;

  document.getElementById('d-active').textContent = active;
  document.getElementById('d-ready').textContent  = ready;
  document.getElementById('d-cust').textContent   = DB.customers.length;
  document.getElementById('d-rev').textContent    = rp(rev);

  const recent = [...DB.orders].sort((a, b) => b.created > a.created ? 1 : -1).slice(0, 5);
  const rEl    = document.getElementById('dash-recent');
  rEl.innerHTML = recent.length
    ? '<table><thead><tr><th>Order</th><th>Pelanggan</th><th>Total</th><th>Status</th></tr></thead><tbody>' +
      recent.map(o => `<tr><td><strong>${o.num}</strong></td><td>${o.custName}</td><td>${rp(o.total)}</td><td>${badge(o.status)}</td></tr>`).join('') +
      '</tbody></table>'
    : '<div class="empty"><div class="empty-ico"><img src="icons/empty-orders.png" width="40" height="40" alt=""></div><h3>Belum ada pesanan</h3></div>';

  const statuses = ['Diterima','Dicuci','Dikeringkan','Disetrika','Siap Ambil','Selesai'];
  const colors   = ['var(--red)','var(--amber)','var(--blue)','var(--violet)','var(--green)','#9ca3af'];
  const counts   = statuses.map(s => DB.orders.filter(o => o.status === s).length);
  const maxC     = Math.max(...counts, 1);
  document.getElementById('dash-bars').innerHTML = DB.orders.length
    ? statuses.map((s, i) =>
        `<div class="bar-row"><span class="bar-lbl">${s}</span><div class="bar-track"><div class="bar-fill" style="width:${counts[i]/maxC*100}%;background:${colors[i]}"></div></div><span class="bar-val">${counts[i]}</span></div>`
      ).join('')
    : '<div class="empty" style="padding:20px"><img src="icons/empty-chart.png" width="40" height="40" alt=""><p>Belum ada data</p></div>';

  const custStats = {};
  DB.orders.forEach(o => {
    if (!custStats[o.custName]) custStats[o.custName] = { count: 0, total: 0 };
    custStats[o.custName].count++;
    custStats[o.custName].total += o.total || 0;
  });
  const topCust   = Object.entries(custStats).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  const rankColors = ['#2563eb','#7c3aed','#16a34a','#d97706','#dc2626'];
  document.getElementById('dash-top-cust').innerHTML = topCust.length
    ? topCust.map(([name, v], i) =>
        `<div style="display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--border)">
          <span style="width:22px;height:22px;border-radius:50%;background:${rankColors[i]};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center">${i+1}</span>
          <span style="flex:1;font-weight:600">${name}</span>
          <span style="font-size:12px;color:var(--text2)">${rp(v.total)}</span>
        </div>`).join('')
    : '<div class="empty" style="padding:20px"><p>Belum ada data</p></div>';
}

// ============================================================
// ORDERS
// ============================================================
function renderOrders() {
  const q    = (document.getElementById('ord-search').value || '').toLowerCase();
  const sf   = document.getElementById('ord-status-f').value;
  const list = DB.orders.filter(o =>
    (!q  || o.custName.toLowerCase().includes(q) || (o.num || '').toLowerCase().includes(q)) &&
    (!sf || o.status === sf)
  ).sort((a, b) => b.created > a.created ? 1 : -1);

  document.getElementById('ord-count').textContent = list.length + ' pesanan';
  const tb = document.getElementById('ord-tbody');

  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="empty-ico"><img src="icons/empty-orders.png" width="40" height="40" alt=""></div><h3>Tidak ada pesanan</h3></div></td></tr>`;
    return;
  }

  tb.innerHTML = list.map(o => `
    <tr>
      <td><strong>${o.num}</strong></td>
      <td>${o.custName}<br><span style="font-size:11px;color:var(--text3)">${o.phone || ''}</span></td>
      <td>${o.svc}</td>
      <td>${o.kg} kg</td>
      <td style="font-weight:600">${rp(o.total)}</td>
      <td>${badge(o.status)}</td>
      <td style="font-size:12px;color:var(--text2)">${fmtDate(o.created)}</td>
      <td>
        <div class="tbl-actions">
          <button class="btn-icon" type="button" title="Detail" onclick="viewOrder('${o.id}')">
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <button class="btn-icon" type="button" title="Edit" onclick="editOrder('${o.id}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" type="button" title="Hapus" onclick="delOrder('${o.id}')">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('ord-search').addEventListener('input', renderOrders);
document.getElementById('ord-status-f').addEventListener('change', renderOrders);

function openOrderModal(o = null) {
  editOrderId = o?.id || null;
  document.getElementById('m-order-title').textContent = o ? 'Edit Pesanan' : 'Tambah Pesanan Baru';
  document.getElementById('o-name').value  = o?.custName || '';
  document.getElementById('o-phone').value = o?.phone    || '';
  document.getElementById('o-kg').value    = o?.kg       || '';
  document.getElementById('o-total').value = o?.total ? rp(o.total) : '';
  document.getElementById('o-notes').value = o?.notes    || '';
  document.getElementById('o-date').value  = o?.created ? o.created.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // Dropdown layanan — tampilkan label yang benar
  const sel = document.getElementById('o-svc');
  sel.innerHTML = '<option value="">Pilih Layanan</option>' +
    DB.services.filter(s => s.active).map(s =>
      `<option value="${s.id}" ${o?.svcId === s.id ? 'selected' : ''}>${svcLabel(s)}</option>`
    ).join('');

  document.getElementById('o-status').value = o?.status || 'Diterima';
  modalOpen('m-order');
}

document.getElementById('o-kg').addEventListener('input',  updateOrderTotal);
document.getElementById('o-svc').addEventListener('change', updateOrderTotal);

function updateOrderTotal() {
  const svcId = document.getElementById('o-svc').value;
  const kg    = parseFloat(document.getElementById('o-kg').value) || 0;
  const svc   = DB.services.find(s => s.id === svcId);
  const total = calcTotal(svc, kg);
  document.getElementById('o-total').value = (svc && kg) ? rp(total) : '';
}

document.getElementById('m-order-close').addEventListener('click',  () => modalClose('m-order'));
document.getElementById('m-order-cancel').addEventListener('click', () => modalClose('m-order'));
document.getElementById('m-order-save').addEventListener('click',   saveOrder);

function saveOrder() {
  const name   = document.getElementById('o-name').value.trim();
  const phone  = document.getElementById('o-phone').value.trim();
  const svcId  = document.getElementById('o-svc').value;
  const kg     = parseFloat(document.getElementById('o-kg').value);
  const status = document.getElementById('o-status').value;
  const notes  = document.getElementById('o-notes').value.trim();
  const dateVal= document.getElementById('o-date').value;

  if (!name || !svcId || !kg) { toast('Nama, layanan, dan berat wajib diisi!', 'err'); return; }

  const svc   = DB.services.find(s => s.id === svcId);
  const total = calcTotal(svc, kg);

  if (editOrderId) {
    const idx = DB.orders.findIndex(o => o.id === editOrderId);
    if (idx > -1) {
      Object.assign(DB.orders[idx], { custName: name, phone, svcId, svc: svc.name, svcType: svc.type, flatKg: svc.flatKg, price: svc.price, kg, total, status, notes });
      if (status === 'Selesai' && !DB.orders[idx].completedAt) DB.orders[idx].completedAt = new Date().toISOString();
    }
    toast('Pesanan diperbarui!', 'ok');
  } else {
    const num      = 'ORD-' + String(DB.orders.length + 1).padStart(3, '0');
    const newOrder = { id: uid(), num, custName: name, phone, svcId, svc: svc.name, svcType: svc.type, flatKg: svc.flatKg, price: svc.price, kg, total, status, notes, created: dateVal + 'T00:00:00.000Z' };
    if (status === 'Selesai') newOrder.completedAt = new Date().toISOString();
    DB.orders.push(newOrder);
    if (!DB.customers.find(c => c.phone === phone)) {
      DB.customers.push({ id: uid(), name, phone, address: '', email: '', joined: dateVal || new Date().toISOString().slice(0, 10) });
    }
    toast('Pesanan berhasil ditambahkan!', 'ok');
  }

  persist(); modalClose('m-order'); refreshAll();
}

function editOrder(id) { openOrderModal(DB.orders.find(o => o.id === id)); }

function viewOrder(id) {
  detailOrderId = id;
  const o = DB.orders.find(o => o.id === id);
  if (!o) return;
  document.getElementById('m-detail-title').textContent = 'Detail ' + o.num;
  const statuses = ['Diterima','Dicuci','Dikeringkan','Disetrika','Siap Ambil','Selesai'];

  // Label harga di detail
  const hargaLabel = o.svcType === 'flat'
    ? `${rp(o.price)}/${o.flatKg}kg (flat) × ${Math.ceil(o.kg / o.flatKg)} paket`
    : `${rp(o.price)}/kg × ${o.kg} kg`;

  document.getElementById('m-detail-body').innerHTML = `
    <div style="margin-bottom:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:4px">Pelanggan</div>
          <div style="font-weight:600">${o.custName}</div>
          <div style="font-size:12px;color:var(--text2)">${o.phone || '-'}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:4px">Layanan</div>
          <div style="font-weight:600">${o.svc}</div>
          <div style="font-size:12px;color:var(--text2)">${hargaLabel}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:4px">Total</div>
          <div style="font-size:20px;font-weight:800;color:var(--green)">${rp(o.total)}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:4px">Status</div>
          <div>${badge(o.status)}</div>
        </div>
      </div>
      ${o.notes ? `<div style="background:var(--bg);border-radius:9px;padding:12px;font-size:13px"><strong>Catatan:</strong> ${o.notes}</div>` : ''}
    </div>
    <div class="fg"><label>Update Status</label>
      <select id="detail-status">${statuses.map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
      ${statuses.map(s =>
        `<button type="button" onclick="quickStatus('${o.id}','${s}')" style="padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;border:2px solid ${o.status===s?'var(--blue)':'var(--border)'};background:${o.status===s?'var(--blue-bg)':'var(--surface)'};color:${o.status===s?'var(--blue)':'var(--text2)'};font-family:inherit">${s}</button>`
      ).join('')}
    </div>`;
  modalOpen('m-detail');
}

function quickStatus(id, status) {
  const idx = DB.orders.findIndex(o => o.id === id);
  if (idx > -1) {
    DB.orders[idx].status = status;
    if (status === 'Selesai' && !DB.orders[idx].completedAt) DB.orders[idx].completedAt = new Date().toISOString();
    persist(); refreshAll(); modalClose('m-detail');
    toast('Status diperbarui: ' + status, 'ok');
  }
}

document.getElementById('m-detail-close').addEventListener('click',  () => modalClose('m-detail'));
document.getElementById('m-detail-cancel').addEventListener('click', () => modalClose('m-detail'));
document.getElementById('m-detail-save').addEventListener('click', () => {
  const status = document.getElementById('detail-status').value;
  quickStatus(detailOrderId, status);
});

function delOrder(id) {
  if (!confirm('Hapus pesanan ini?')) return;
  DB.orders = DB.orders.filter(o => o.id !== id);
  DB_FS.collection('orders').doc(String(id)).delete().catch(() => {});
  persist(); refreshAll(); toast('Pesanan dihapus', 'ok');
}

document.getElementById('btn-export-csv').addEventListener('click', exportCSV);

function exportCSV() {
  const rows = [['No. Order','Pelanggan','Telepon','Layanan','Berat (kg)','Total (Rp)','Status','Tanggal']];
  DB.orders.forEach(o => rows.push([o.num, o.custName, o.phone, o.svc, o.kg, Math.round(o.total), o.status, fmtDate(o.created)]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href     = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'pesanan-laundry-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  toast('CSV berhasil diunduh!', 'ok');
}

// ============================================================
// CUSTOMERS
// ============================================================
function renderCustomers() {
  const q    = (document.getElementById('cust-search').value || '').toLowerCase();
  const sort = document.getElementById('cust-sort').value;
  let list   = DB.customers.filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q));

  const custOrders = {}, custSpend = {};
  DB.orders.forEach(o => {
    if (!custOrders[o.custName]) { custOrders[o.custName] = 0; custSpend[o.custName] = 0; }
    custOrders[o.custName]++;
    custSpend[o.custName] += o.total || 0;
  });

  if (sort === 'name')        list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'spend')  list.sort((a, b) => (custSpend[b.name] || 0) - (custSpend[a.name] || 0));
  else                        list.sort((a, b) => b.joined > a.joined ? 1 : -1);

  document.getElementById('cust-count').textContent = list.length + ' pelanggan';
  const tb = document.getElementById('cust-tbody');

  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="7"><div class="empty"><h3>Tidak ada pelanggan</h3></div></td></tr>`;
    return;
  }

  tb.innerHTML = list.map(c => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">${c.name[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:600">${c.name}</div>
            <div style="font-size:11px;color:var(--text3)">${c.email || ''}</div>
          </div>
        </div>
      </td>
      <td>${c.phone || '-'}</td>
      <td style="font-size:12px;color:var(--text2)">${c.address || '-'}</td>
      <td style="text-align:center"><span class="badge b-blue">${custOrders[c.name] || 0}x</span></td>
      <td style="font-weight:600">${rp(custSpend[c.name] || 0)}</td>
      <td style="font-size:12px;color:var(--text2)">${fmtDate(c.joined)}</td>
      <td>
        <div class="tbl-actions">
          <button class="btn-icon" type="button" title="Edit" onclick="editCustomer('${c.id}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" type="button" title="Hapus" onclick="delCustomer('${c.id}')">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

document.getElementById('cust-search').addEventListener('input', renderCustomers);
document.getElementById('cust-sort').addEventListener('change', renderCustomers);

function openCustModal(c = null) {
  editCustId = c?.id || null;
  document.getElementById('m-cust-title').textContent = c ? 'Edit Pelanggan' : 'Tambah Pelanggan';
  document.getElementById('c-name').value  = c?.name    || '';
  document.getElementById('c-phone').value = c?.phone   || '';
  document.getElementById('c-addr').value  = c?.address || '';
  document.getElementById('c-email').value = c?.email   || '';
  document.getElementById('c-dob').value   = c?.dob     || '';
  modalOpen('m-cust');
}

document.getElementById('m-cust-close').addEventListener('click',  () => modalClose('m-cust'));
document.getElementById('m-cust-cancel').addEventListener('click', () => modalClose('m-cust'));
document.getElementById('m-cust-save').addEventListener('click',   saveCustomer);

function saveCustomer() {
  const name    = document.getElementById('c-name').value.trim();
  const phone   = document.getElementById('c-phone').value.trim();
  const address = document.getElementById('c-addr').value.trim();
  const email   = document.getElementById('c-email').value.trim();
  const dob     = document.getElementById('c-dob').value;

  if (!name || !phone) { toast('Nama dan telepon wajib diisi!', 'err'); return; }

  if (editCustId) {
    const idx = DB.customers.findIndex(c => c.id === editCustId);
    if (idx > -1) Object.assign(DB.customers[idx], { name, phone, address, email, dob });
    toast('Pelanggan diperbarui!', 'ok');
  } else {
    DB.customers.push({ id: uid(), name, phone, address, email, dob, joined: new Date().toISOString().slice(0, 10) });
    toast('Pelanggan ditambahkan!', 'ok');
  }

  persist(); modalClose('m-cust'); renderCustomers();
}

function editCustomer(id) { openCustModal(DB.customers.find(c => c.id === id)); }

function delCustomer(id) {
  if (!confirm('Hapus pelanggan ini?')) return;
  DB.customers = DB.customers.filter(c => c.id !== id);
  DB_FS.collection('customers').doc(String(id)).delete().catch(() => {});
  persist(); renderCustomers(); toast('Pelanggan dihapus', 'ok');
}

// ============================================================
// SERVICES
// ============================================================
function renderServices() {
  document.getElementById('svc-count').textContent = DB.services.length + ' layanan';
  const tb = document.getElementById('svc-tbody');

  if (!DB.services.length) {
    tb.innerHTML = `<tr><td colspan="6"><div class="empty"><h3>Belum ada layanan</h3><p>Klik "+ Tambah Layanan"</p></div></td></tr>`;
    return;
  }

  tb.innerHTML = DB.services.map(s => `
    <tr>
      <td style="font-weight:600">${s.name}</td>
      <td style="font-weight:700;color:var(--blue)">${s.type === 'flat' ? rp(s.price) + '/' + s.flatKg + 'kg' : rp(s.price) + '/kg'}</td>
      <td style="font-size:12px;color:var(--text2)">${s.duration || '-'}</td>
      <td style="font-size:12px;color:var(--text2)">${s.description || '-'}</td>
      <td><span class="badge ${s.active ? 'b-green' : 'b-gray'}">${s.active ? 'Aktif' : 'Nonaktif'}</span></td>
      <td>
        <div class="tbl-actions">
          <button class="btn-icon" type="button" title="Edit" onclick="editService('${s.id}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon danger" type="button" title="Hapus" onclick="delService('${s.id}')">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

function openSvcModal(s = null) {
  editSvcId = s?.id || null;
  document.getElementById('m-svc-title').textContent = s ? 'Edit Layanan' : 'Tambah Layanan';
  document.getElementById('s-name').value   = s?.name        || '';
  document.getElementById('s-price').value  = s?.price       || '';
  document.getElementById('s-dur').value    = s?.duration    || '';
  document.getElementById('s-desc').value   = s?.description || '';
  document.getElementById('s-active').value = s?.active ? '1' : '0';
  modalOpen('m-svc');
}

document.getElementById('m-svc-close').addEventListener('click',  () => modalClose('m-svc'));
document.getElementById('m-svc-cancel').addEventListener('click', () => modalClose('m-svc'));
document.getElementById('m-svc-save').addEventListener('click',   saveService);

function saveService() {
  const name        = document.getElementById('s-name').value.trim();
  const price       = parseFloat(document.getElementById('s-price').value);
  const duration    = document.getElementById('s-dur').value.trim();
  const description = document.getElementById('s-desc').value.trim();
  const active      = document.getElementById('s-active').value === '1';

  if (!name || !price || price <= 0) { toast('Nama dan harga wajib diisi!', 'err'); return; }

  if (editSvcId) {
    const idx = DB.services.findIndex(s => s.id === editSvcId);
    if (idx > -1) Object.assign(DB.services[idx], { name, price, duration, description, active });
    toast('Layanan diperbarui!', 'ok');
  } else {
    DB.services.push({ id: uid(), name, price, type: 'per_kg', flatKg: 0, duration, description, active });
    toast('Layanan ditambahkan!', 'ok');
  }

  persist(); modalClose('m-svc'); renderServices();
}

function editService(id) { openSvcModal(DB.services.find(s => s.id === id)); }

function delService(id) {
  if (!confirm('Hapus layanan ini?')) return;
  DB.services = DB.services.filter(s => s.id !== id);
  DB_FS.collection('services').doc(String(id)).delete().catch(() => {});
  persist(); renderServices(); toast('Layanan dihapus', 'ok');
}

// ============================================================
// CASHIER
// ============================================================
function renderCashier() {
  const ready = DB.orders.filter(o => o.status === 'Siap Ambil');
  const tb    = document.getElementById('cashier-tbody');

  if (!ready.length) {
    tb.innerHTML = `<tr><td colspan="5"><div class="empty"><h3>Tidak ada pesanan siap bayar</h3></div></td></tr>`;
    return;
  }

  tb.innerHTML = ready.map(o => `
    <tr>
      <td><strong>${o.num}</strong></td>
      <td>${o.custName}</td>
      <td>${o.svc}</td>
      <td style="font-weight:700;color:var(--green)">${rp(o.total)}</td>
      <td><button class="btn btn-green btn-sm" type="button" onclick="selectCashierOrder('${o.id}')">Bayar</button></td>
    </tr>`).join('');
}

function selectCashierOrder(id) {
  cashierOrderId = id;
  const o        = DB.orders.find(o => o.id === id);
  if (!o) return;
  const now      = new Date();
  const settings = DB.settings;
  const hargaLabel = o.svcType === 'flat'
    ? `${rp(o.price)}/${o.flatKg}kg × ${Math.ceil(o.kg / (o.flatKg || 1))} paket`
    : `${rp(o.price)}/kg × ${o.kg} kg`;

  document.getElementById('cashier-receipt').innerHTML = `
    <div class="receipt">
      <div class="receipt-head">${settings.name || 'Laundry Dewi'}</div>
      <div style="text-align:center;font-size:11px;margin-bottom:12px">${settings.address || 'Medan'} | ${settings.phone || ''}</div>
      <div class="receipt-line"></div>
      <div class="receipt-row"><span>No. Order</span><span>${o.num}</span></div>
      <div class="receipt-row"><span>Tanggal</span><span>${now.toLocaleDateString('id-ID')}</span></div>
      <div class="receipt-row"><span>Pelanggan</span><span>${o.custName}</span></div>
      <div class="receipt-line"></div>
      <div class="receipt-row"><span>Layanan</span><span>${o.svc}</span></div>
      <div class="receipt-row"><span>Berat</span><span>${o.kg} kg</span></div>
      <div class="receipt-row"><span>Harga</span><span>${hargaLabel}</span></div>
      <div class="receipt-line"></div>
      <div class="receipt-total"><span>TOTAL</span><span>${rp(o.total)}</span></div>
      <div class="receipt-line"></div>
      <div style="text-align:center;font-size:12px;color:var(--text2)">Terima kasih atas kepercayaan Anda!</div>
    </div>`;
  document.getElementById('cashier-btns').style.display = 'flex';
}

document.getElementById('btn-confirm-pay').addEventListener('click', () => {
  if (!cashierOrderId) return;
  const idx = DB.orders.findIndex(o => o.id === cashierOrderId);
  if (idx > -1) { DB.orders[idx].status = 'Selesai'; DB.orders[idx].completedAt = new Date().toISOString(); }
  persist(); renderCashier(); updateBadges();
  document.getElementById('cashier-receipt').innerHTML = '<div class="empty"><h3>Pembayaran Dikonfirmasi</h3><p>Pesanan telah selesai</p></div>';
  document.getElementById('cashier-btns').style.display = 'none';
  cashierOrderId = null;
  toast('Pembayaran berhasil dikonfirmasi!', 'ok');
});

document.getElementById('btn-print-receipt').addEventListener('click', () => window.print());

// ============================================================
// REPORTS
// ============================================================
function renderReports() {
  const period = document.getElementById('rep-period').value;
  const now    = new Date();
  let from     = new Date(0);
  if      (period === 'month')      from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (period === 'last_month') from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  else if (period === 'week')       { from = new Date(now); from.setDate(from.getDate() - 7); }

  const done = DB.orders.filter(o => o.status === 'Selesai' && new Date(o.completedAt || o.created) >= from);
  const rev  = done.reduce((s, o) => s + (o.total || 0), 0);
  const kg   = done.reduce((s, o) => s + (o.kg || 0), 0);

  document.getElementById('rep-rev').textContent = rp(rev);
  document.getElementById('rep-ord').textContent = done.length;
  document.getElementById('rep-kg').textContent  = kg.toFixed(1) + ' kg';
  document.getElementById('rep-avg').textContent = done.length ? rp(rev / done.length) : 'Rp 0';

  const tb     = document.getElementById('rep-tbody');
  const sorted = [...done].sort((a, b) => b.completedAt > a.completedAt ? 1 : -1);
  tb.innerHTML = sorted.length
    ? sorted.map(o => `<tr><td>${o.num}</td><td>${o.custName}</td><td>${o.svc}</td><td>${o.kg}kg</td><td style="font-weight:600">${rp(o.total)}</td><td style="font-size:12px">${fmtDate(o.completedAt || o.created)}</td></tr>`).join('')
    : `<tr><td colspan="6"><div class="empty" style="padding:24px"><p>Tidak ada data</p></div></td></tr>`;

  const svcRev = {};
  done.forEach(o => { svcRev[o.svc] = (svcRev[o.svc] || 0) + (o.total || 0); });
  const svcArr = Object.entries(svcRev).sort((a, b) => b[1] - a[1]);
  const maxR   = Math.max(...svcArr.map(s => s[1]), 1);
  document.getElementById('rep-bars').innerHTML = svcArr.length
    ? svcArr.map(([n, v]) =>
        `<div class="bar-row"><span class="bar-lbl">${n}</span><div class="bar-track"><div class="bar-fill" style="width:${v/maxR*100}%;background:var(--blue)"></div></div><span class="bar-val" style="font-size:11px">${rp(v)}</span></div>`
      ).join('')
    : '<p style="color:var(--text3);font-size:13px;text-align:center;padding:16px">Tidak ada data</p>';
}

document.getElementById('rep-period').addEventListener('change', renderReports);
document.getElementById('btn-rep-refresh').addEventListener('click', renderReports);
document.getElementById('btn-print-report').addEventListener('click', () => window.print());

// ============================================================
// SETTINGS
// ============================================================
function loadSettings() {
  const s = DB.settings;
  if (s.name)    document.getElementById('set-nm').value   = s.name;
  if (s.phone)   document.getElementById('set-ph').value   = s.phone;
  if (s.address) document.getElementById('set-addr').value = s.address;
  if (s.open)    document.getElementById('set-op').value   = s.open;
  if (s.close)   document.getElementById('set-cl').value   = s.close;
  if (s.email)   document.getElementById('set-em').value   = s.email;
}

function saveSettings() {
  DB.settings = {
    name:    document.getElementById('set-nm').value,
    phone:   document.getElementById('set-ph').value,
    address: document.getElementById('set-addr').value,
    open:    document.getElementById('set-op').value,
    close:   document.getElementById('set-cl').value,
    email:   document.getElementById('set-em').value
  };
  persist(); toast('Pengaturan disimpan!', 'ok');
}

document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
document.getElementById('btn-export-all').addEventListener('click', exportCSV);
