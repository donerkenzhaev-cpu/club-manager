/* Club Manager - Mobile Web App JS */

let currentPage = 'billiard';
let currentSession = null;
let currentTableId = null;
let currentTableType = null;
let timerInterval = null;
let settings = {};
let allProducts = [];
let editingProductId = null;

// ─────────────────────── INIT ─────────────────────────────────

window.addEventListener('load', async () => {
  await loadSettings();
  loadPage('billiard');
});

// ─────────────────────── NAVIGATION ───────────────────────────

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('nav-' + page).classList.add('active');
  currentPage = page;
  loadPage(page);
}

function loadPage(page) {
  if (page === 'billiard' || page === 'table_tennis') loadTables(page);
  else if (page === 'history') loadHistory();
  else if (page === 'products') loadProducts();
  else if (page === 'settings') fillSettings();
}

// ─────────────────────── SETTINGS ─────────────────────────────

async function loadSettings() {
  const res = await fetch('/api/settings');
  settings = await res.json();
}

function fillSettings() {
  document.getElementById('set-billiard-rate').value = settings.billiard_hourly_rate || 10;
  document.getElementById('set-tt-rate').value = settings.table_tennis_hourly_rate || 5;
  const sel = document.getElementById('set-currency');
  for (let opt of sel.options) {
    if (opt.value === (settings.currency || 'USD')) opt.selected = true;
  }
}

async function saveSettings() {
  const data = {
    billiard_hourly_rate: document.getElementById('set-billiard-rate').value,
    table_tennis_hourly_rate: document.getElementById('set-tt-rate').value,
    currency: document.getElementById('set-currency').value,
  };
  await fetch('/api/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
  await loadSettings();
  toast('✅ Настройки сохранены!');
}

// ─────────────────────── CURRENCY ─────────────────────────────

function fmt(amount) {
  const cur = settings.currency || 'USD';
  const symbols = { USD: '$', EUR: '€', UZS: 'сум ', RUB: '₽', KZT: '₸' };
  const sym = symbols[cur] || cur + ' ';
  return sym + Number(amount || 0).toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ─────────────────────── TABLES ───────────────────────────────

async function loadTables(type) {
  const res = await fetch('/api/tables?type=' + type);
  const tables = await res.json();
  const grid = document.getElementById('grid-' + type);

  if (tables.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🎱</div>
      <div>Нет столов.<br>Нажмите «+ Добавить» чтобы создать первый стол.</div>
    </div>`;
    return;
  }

  grid.innerHTML = tables.map(t => {
    const status = t.status || 'free';
    const statusLabel = { free: 'Свободен', active: 'Активен', paused: 'Пауза', finished: 'Завершён' }[status] || status;
    const timer = t.totals ? fmtTime(t.totals.elapsed_seconds) : '00:00:00';
    const total = t.totals ? fmt(t.totals.total) : '—';
    const img = t.table_type === 'billiard' ? '/static/img/billiard_table.png' : '/static/img/table_tennis_table.png';

    return `<div class="table-card status-${status}" onclick="openSession(${t.id}, '${t.table_type}')">
      <img src="${img}" alt="${t.name}" loading="lazy">
      <div class="table-card-body">
        <div class="table-card-name">${t.name}</div>
        <div><span class="table-card-status badge badge-${status}">${statusLabel}</span></div>
        <div class="table-card-timer">${timer}</div>
        <div class="table-card-total">${total}</div>
      </div>
      <div class="table-card-actions">
        <button onclick="event.stopPropagation(); editTableModal(${t.id}, '${t.name}', ${t.hourly_rate || 0})">✏️</button>
        <button onclick="event.stopPropagation(); confirmDeleteTable(${t.id})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function openAddTableModal(type) {
  document.getElementById('modal-add-title').textContent =
    type === 'billiard' ? '🎱 Добавить стол' : '🏓 Добавить стол';
  document.getElementById('new-table-type').value = type;
  document.getElementById('new-table-name').value = '';
  document.getElementById('new-table-rate').value = '';
  openModal('modal-add-table');
}

async function addTable() {
  const name = document.getElementById('new-table-name').value.trim();
  const type = document.getElementById('new-table-type').value;
  const rate = parseFloat(document.getElementById('new-table-rate').value) || null;

  if (!name) { toast('⚠️ Введите название стола'); return; }

  const res = await fetch('/api/tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, table_type: type, hourly_rate: rate })
  });
  const data = await res.json();
  if (data.error) { toast('⚠️ ' + data.error); return; }
  closeModal('modal-add-table');
  loadTables(type);
  toast('✅ Стол добавлен!');
}

function editTableModal(id, name, rate) {
  document.getElementById('modal-add-title').textContent = '✏️ Редактировать стол';
  document.getElementById('new-table-name').value = name;
  document.getElementById('new-table-rate').value = rate || '';
  document.getElementById('new-table-type').value = '__edit__' + id;
  openModal('modal-add-table');
}

// Override addTable to handle edit
const origAddTable = addTable;
window.addTable = async function() {
  const typeVal = document.getElementById('new-table-type').value;
  if (typeVal.startsWith('__edit__')) {
    const id = parseInt(typeVal.replace('__edit__', ''));
    const name = document.getElementById('new-table-name').value.trim();
    const rate = parseFloat(document.getElementById('new-table-rate').value) || null;
    if (!name) { toast('⚠️ Введите название'); return; }
    await fetch('/api/tables/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, hourly_rate: rate })
    });
    closeModal('modal-add-table');
    loadTables(currentPage);
    toast('✅ Стол обновлён!');
  } else {
    origAddTable();
  }
};

function confirmDeleteTable(id) {
  confirm2('Удалить этот стол и всю его историю?', async () => {
    const res = await fetch('/api/tables/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) { toast('⚠️ ' + data.error); return; }
    loadTables(currentPage);
    toast('🗑️ Стол удалён');
  });
}

// ─────────────────────── SESSION ──────────────────────────────

async function openSession(tableId, tableType) {
  currentTableId = tableId;
  currentTableType = tableType;

  // Load table data
  const res = await fetch('/api/tables');
  const tables = await res.json();
  const table = tables.find(t => t.id === tableId);
  if (!table) return;

  currentSession = table.session;

  // Set image
  const img = tableType === 'billiard' ? '/static/img/billiard_table.png' : '/static/img/table_tennis_table.png';
  document.getElementById('sess-image').src = img;
  document.getElementById('sess-title').textContent = table.name;

  await refreshSessionModal(table);
  openModal('modal-session');

  // Start timer
  clearInterval(timerInterval);
  if (currentSession && currentSession.status === 'active') {
    timerInterval = setInterval(() => tickTimer(), 1000);
  }
}

async function refreshSessionModal(tableData) {
  const res = tableData || await (async () => {
    const r = await fetch('/api/tables');
    const tables = await r.json();
    return tables.find(t => t.id === currentTableId);
  })();

  currentSession = res.session;
  const session = currentSession;

  // Status
  const status = res.status || 'free';
  const badge = document.getElementById('sess-status-badge');
  badge.textContent = { free: 'Свободен', active: 'Активен', paused: 'Пауза', finished: 'Завершён' }[status] || status;
  badge.className = 'badge badge-' + status;

  // Rate
  const rate = session ? session.hourly_rate : (res.hourly_rate || (settings[res.table_type + '_hourly_rate']));
  document.getElementById('sess-rate-label').textContent = rate ? fmt(rate) + '/час' : '';

  // Costs
  if (session) {
    const totals = res.totals || (await (await fetch('/api/sessions/' + session.id + '/totals')).json());
    document.getElementById('sess-timer').textContent = fmtTime(totals.elapsed_seconds);
    document.getElementById('sess-time-cost').textContent = fmt(totals.time_cost);
    document.getElementById('sess-prod-cost').textContent = fmt(totals.products_cost);
    document.getElementById('sess-total').textContent = fmt(totals.total);
  } else {
    document.getElementById('sess-timer').textContent = '00:00:00';
    document.getElementById('sess-time-cost').textContent = '—';
    document.getElementById('sess-prod-cost').textContent = '—';
    document.getElementById('sess-total').textContent = '—';
  }

  // Controls
  renderSessionControls(status, session);

  // Products section
  const prodSection = document.getElementById('sess-products-section');
  if (session && status !== 'finished') {
    prodSection.style.display = 'block';
    await loadSessionProducts(session.id);
    await loadProductsCombo();
  } else {
    prodSection.style.display = 'none';
  }
}

function renderSessionControls(status, session) {
  const ctrl = document.getElementById('sess-controls');
  let html = '';
  if (status === 'free') {
    html = `<button class="btn-green" style="grid-column:1/-1" onclick="startSession()">▶ Начать сессию</button>`;
  } else if (status === 'active') {
    html = `
      <button class="btn-orange" onclick="pauseSession()">⏸ Пауза</button>
      <button class="btn-purple" onclick="endSession()">⏹ Завершить</button>
      <button class="btn-red" style="grid-column:1/-1" onclick="resetSession()">🔄 Сбросить</button>`;
  } else if (status === 'paused') {
    html = `
      <button class="btn-blue" onclick="resumeSession()">▶ Продолжить</button>
      <button class="btn-purple" onclick="endSession()">⏹ Завершить</button>
      <button class="btn-red" style="grid-column:1/-1" onclick="resetSession()">🔄 Сбросить</button>`;
  } else if (status === 'finished') {
    html = `<button class="btn-green" style="grid-column:1/-1" onclick="startSession()">▶ Новая сессия</button>`;
  }
  ctrl.innerHTML = html;
}

async function tickTimer() {
  if (!currentSession) return;
  const res = await fetch('/api/sessions/' + currentSession.id + '/totals');
  const totals = await res.json();
  document.getElementById('sess-timer').textContent = fmtTime(totals.elapsed_seconds);
  document.getElementById('sess-time-cost').textContent = fmt(totals.time_cost);
  document.getElementById('sess-total').textContent = fmt(totals.time_cost + totals.products_cost);
}

async function startSession() {
  const res = await fetch('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table_id: currentTableId })
  });
  const data = await res.json();
  if (data.error) { toast('⚠️ ' + data.error); return; }
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 1000);
  await refreshSessionModal();
  loadTables(currentTableType);
  toast('▶ Сессия начата!');
}

async function pauseSession() {
  if (!currentSession) return;
  await fetch('/api/sessions/' + currentSession.id + '/pause', { method: 'POST' });
  clearInterval(timerInterval);
  await refreshSessionModal();
  loadTables(currentTableType);
  toast('⏸ Пауза');
}

async function resumeSession() {
  if (!currentSession) return;
  await fetch('/api/sessions/' + currentSession.id + '/resume', { method: 'POST' });
  timerInterval = setInterval(tickTimer, 1000);
  await refreshSessionModal();
  loadTables(currentTableType);
  toast('▶ Продолжено');
}

async function endSession() {
  if (!currentSession) return;
  confirm2('Завершить и сохранить сессию?', async () => {
    await fetch('/api/sessions/' + currentSession.id + '/end', { method: 'POST' });
    clearInterval(timerInterval);
    await refreshSessionModal();
    loadTables(currentTableType);
    toast('✅ Сессия завершена!');
  });
}

async function resetSession() {
  if (!currentSession) return;
  confirm2('Удалить текущую сессию? Данные не сохранятся.', async () => {
    await fetch('/api/sessions/' + currentSession.id + '/reset', { method: 'POST' });
    clearInterval(timerInterval);
    currentSession = null;
    await refreshSessionModal();
    loadTables(currentTableType);
    toast('🔄 Сессия сброшена');
  });
}

function closeSessionModal() {
  clearInterval(timerInterval);
  closeModal('modal-session');
  loadTables(currentTableType || currentPage);
}

// ─────────────────────── SESSION PRODUCTS ─────────────────────

async function loadSessionProducts(sessionId) {
  const res = await fetch('/api/sessions/' + sessionId + '/products');
  const items = await res.json();
  const list = document.getElementById('sess-products-list');

  if (items.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:10px">Нет товаров</div>';
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="sess-prod-item">
      <div class="sess-prod-info">
        <div class="sess-prod-name">${item.product_name}</div>
        <div class="sess-prod-price">${fmt(item.unit_price)} × ${item.quantity} = ${fmt(item.subtotal)}</div>
      </div>
      <div class="sess-prod-qty">
        <button class="qty-btn" onclick="changeQty(${item.id}, ${item.quantity - 1}, ${sessionId})">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" onclick="changeQty(${item.id}, ${item.quantity + 1}, ${sessionId})">+</button>
      </div>
      <button class="sess-prod-del" onclick="deleteSessionProduct(${item.id}, ${sessionId})">✕</button>
    </div>
  `).join('');
}

async function loadProductsCombo() {
  const res = await fetch('/api/products');
  allProducts = await res.json();
  const sel = document.getElementById('sess-prod-select');
  if (allProducts.length === 0) {
    sel.innerHTML = '<option>Нет товаров — добавьте в каталоге</option>';
    return;
  }
  sel.innerHTML = allProducts.map(p =>
    `<option value="${p.id}" data-price="${p.price}">${p.name} (${fmt(p.price)})</option>`
  ).join('');
}

async function addProductToSession() {
  if (!currentSession) return;
  const sel = document.getElementById('sess-prod-select');
  const opt = sel.options[sel.selectedIndex];
  if (!opt) return;
  const product = allProducts.find(p => p.id == sel.value);
  if (!product) return;
  const qty = parseInt(document.getElementById('sess-prod-qty').value) || 1;

  await fetch('/api/sessions/' + currentSession.id + '/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_name: product.name, unit_price: product.price, quantity: qty })
  });
  await loadSessionProducts(currentSession.id);
  await tickTimer();
  // Refresh totals display
  const tot = await (await fetch('/api/sessions/' + currentSession.id + '/totals')).json();
  document.getElementById('sess-prod-cost').textContent = fmt(tot.products_cost);
  document.getElementById('sess-total').textContent = fmt(tot.total);
  toast('✅ Товар добавлен');
}

async function changeQty(itemId, newQty, sessionId) {
  if (newQty < 1) { deleteSessionProduct(itemId, sessionId); return; }
  await fetch('/api/session_products/' + itemId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: newQty })
  });
  await loadSessionProducts(sessionId);
  const tot = await (await fetch('/api/sessions/' + sessionId + '/totals')).json();
  document.getElementById('sess-prod-cost').textContent = fmt(tot.products_cost);
  document.getElementById('sess-total').textContent = fmt(tot.total);
}

async function deleteSessionProduct(itemId, sessionId) {
  await fetch('/api/session_products/' + itemId, { method: 'DELETE' });
  await loadSessionProducts(sessionId);
  const tot = await (await fetch('/api/sessions/' + sessionId + '/totals')).json();
  document.getElementById('sess-prod-cost').textContent = fmt(tot.products_cost);
  document.getElementById('sess-total').textContent = fmt(tot.total);
}

// ─────────────────────── HISTORY ──────────────────────────────

async function loadHistory() {
  const type = document.getElementById('history-filter').value;
  const res = await fetch('/api/sessions/history?type=' + type);
  const sessions = await res.json();

  // Summary
  let totalTime = 0, totalProd = 0;
  sessions.forEach(s => { totalTime += s.totals.time_cost; totalProd += s.totals.products_cost; });
  document.getElementById('history-summary').innerHTML = `
    <div class="sum-item"><div class="sum-label">Сессий</div><div class="sum-value">${sessions.length}</div></div>
    <div class="sum-item"><div class="sum-label">Время</div><div class="sum-value">${fmt(totalTime)}</div></div>
    <div class="sum-item"><div class="sum-label">Товары</div><div class="sum-value">${fmt(totalProd)}</div></div>
    <div class="sum-item"><div class="sum-label">ИТОГО</div><div class="sum-value">${fmt(totalTime + totalProd)}</div></div>
  `;

  if (sessions.length === 0) {
    document.getElementById('history-list').innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div>Нет завершённых сессий</div></div>`;
    return;
  }

  document.getElementById('history-list').innerHTML = sessions.map(s => {
    const start = new Date(s.start_time);
    const dateStr = start.toLocaleDateString('ru') + ' ' + start.toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'});
    const typeLabel = s.table_type === 'billiard' ? '🎱' : '🏓';
    return `<div class="history-item">
      <div class="hist-header">
        <div class="hist-table">${typeLabel} ${s.table_name}</div>
        <div class="hist-date">${dateStr}</div>
      </div>
      <div class="hist-row"><span>Длительность</span><span>${fmtTime(s.totals.elapsed_seconds)}</span></div>
      <div class="hist-row"><span>Время</span><span>${fmt(s.totals.time_cost)}</span></div>
      <div class="hist-row"><span>Товары</span><span>${fmt(s.totals.products_cost)}</span></div>
      <div class="hist-total"><span>ИТОГО</span><span>${fmt(s.totals.total)}</span></div>
    </div>`;
  }).join('');
}

// ─────────────────────── PRODUCTS ─────────────────────────────

async function loadProducts() {
  const res = await fetch('/api/products');
  allProducts = await res.json();
  const list = document.getElementById('products-list');

  if (allProducts.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🛒</div><div>Нет товаров.<br>Добавьте первый товар выше.</div></div>`;
    return;
  }

  list.innerHTML = allProducts.map(p => `
    <div class="product-item">
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-price">${fmt(p.price)}</div>
      </div>
      <div class="product-actions">
        <button onclick="editProduct(${p.id}, '${p.name.replace(/'/g,"\\'")}', ${p.price})" title="Редактировать">✏️</button>
        <button onclick="deleteProduct(${p.id})" title="Удалить" style="color:var(--red)">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function saveProduct() {
  const name = document.getElementById('prod-name').value.trim();
  const price = parseFloat(document.getElementById('prod-price').value) || 0;
  if (!name) { toast('⚠️ Введите название'); return; }

  if (editingProductId) {
    await fetch('/api/products/' + editingProductId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price })
    });
    toast('✅ Товар обновлён!');
  } else {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price })
    });
    const data = await res.json();
    if (data.error) { toast('⚠️ ' + data.error); return; }
    toast('✅ Товар добавлен!');
  }
  clearProductForm();
  loadProducts();
}

function editProduct(id, name, price) {
  editingProductId = id;
  document.getElementById('prod-name').value = name;
  document.getElementById('prod-price').value = price;
}

async function deleteProduct(id) {
  confirm2('Удалить этот товар из каталога?', async () => {
    await fetch('/api/products/' + id, { method: 'DELETE' });
    loadProducts();
    toast('🗑️ Товар удалён');
  });
}

function clearProductForm() {
  editingProductId = null;
  document.getElementById('prod-name').value = '';
  document.getElementById('prod-price').value = '';
}

// ─────────────────────── MODALS ───────────────────────────────

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function confirm2(text, callback) {
  document.getElementById('confirm-text').textContent = text;
  document.getElementById('confirm-ok-btn').onclick = () => {
    closeModal('modal-confirm');
    callback();
  };
  openModal('modal-confirm');
}

// Close modal on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal) {
      if (modal.id === 'modal-session') closeSessionModal();
      else closeModal(modal.id);
    }
  });
});

// ─────────────────────── TOAST ────────────────────────────────

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ─────────────────────── AUTO REFRESH ─────────────────────────

// Refresh table cards every 10 seconds
setInterval(() => {
  if (currentPage === 'billiard' || currentPage === 'table_tennis') {
    loadTables(currentPage);
  }
}, 10000);
