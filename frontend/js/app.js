/* app.js — MBTS Dashboard Logic */

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'fadeOut .4s ease forwards'; setTimeout(() => t.remove(), 400); }, 3500);
}

async function apiPost(path, body) {
  try { const r = await fetch(`${API_BASE}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); return await r.json(); }
  catch(e) { return { error: e.message }; }
}
async function apiGet(path) {
  try { const r = await fetch(`${API_BASE}${path}`); return await r.json(); }
  catch(e) { return { error: e.message }; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pretty(o) { return JSON.stringify(o, null, 2); }

let demoRunning = false;
function setDemoRunning(v) {
  demoRunning = v;
  document.querySelectorAll('.btn-demo').forEach(b => b.disabled = v);
  const ind = document.getElementById('demo-indicator');
  if (ind) ind.style.display = v ? 'flex' : 'none';
}

// ─── Panel 1: Accounts ──────────────────────────────────────────────
async function loadAccounts() {
  const d = await apiGet('/accounts');
  const tb = document.querySelector('#accounts-table tbody');
  tb.innerHTML = '';
  if (!d.accounts || !d.accounts.length) { tb.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:16px">No accounts</td></tr>'; return; }
  d.accounts.forEach(a => {
    const r = document.createElement('tr');
    r.innerHTML = `<td class="mono">${a.account_id}</td><td>${a.customer_name}</td><td class="mono" style="color:var(--accent2)">₹${a.balance.toLocaleString()}</td><td><span class="tag tag-${a.status}">${a.status}</span></td>`;
    tb.appendChild(r);
  });
}
async function createAccount() {
  const id = document.getElementById('new-acc-id').value.trim();
  const nm = document.getElementById('new-acc-name').value.trim();
  const bl = parseFloat(document.getElementById('new-acc-balance').value);
  if (!id||!nm||isNaN(bl)) { showToast('Fill all fields','error'); return; }
  const r = await apiPost('/accounts', { account_id:id, customer_name:nm, balance:bl });
  if (r.success) { showToast(`Account ${id} created`,'success'); loadAccounts(); } else showToast(r.error||'Failed','error');
}

// ─── Panel 2: Transaction Controls ──────────────────────────────────
function getTxn() {
  return { txn_id: document.getElementById('txn-id').value.trim(), account_id: document.getElementById('txn-acc').value.trim(),
    amount: parseFloat(document.getElementById('txn-amount').value)||0, op_type: document.getElementById('txn-op').value,
    target_acc: document.getElementById('txn-target').value.trim() };
}
function setResult(obj) {
  const el = document.getElementById('txn-result');
  el.textContent = pretty(obj);
  el.className = obj.success === false || obj.error ? 'error' : 'success';
}

async function txnBegin() {
  const {txn_id, op_type} = getTxn();
  if (!txn_id) { showToast('TXN ID required','error'); return; }
  const r = await apiPost('/actions/transaction/begin', { transaction_id:txn_id, txn_type:op_type });
  setResult(r); showToast(r.success ? `${txn_id} started` : r.error, r.success?'success':'error');
}
async function txnRead() {
  const {txn_id, account_id} = getTxn();
  if (!txn_id||!account_id) { showToast('TXN & Account ID needed','error'); return; }
  await apiPost('/actions/lock/acquire', { transaction_id:txn_id, account_id, lock_type:'S' });
  const r = await apiPost('/actions/transaction/read', { transaction_id:txn_id, account_id });
  setResult(r); showToast(r.success ? `Read: ₹${r.balance}` : r.error, r.success?'info':'error'); loadLockTable();
}
async function txnWrite() {
  const {txn_id, account_id, amount, op_type, target_acc} = getTxn();
  if (!txn_id||!account_id) { showToast('TXN & Account ID needed','error'); return; }
  const rd = await apiPost('/actions/transaction/read', { transaction_id:txn_id, account_id });
  if (!rd.success) { showToast('Read failed','error'); return; }
  const old_v = rd.balance;
  let new_v;
  if (op_type==='deposit') new_v = old_v + amount;
  else if (op_type==='withdrawal') { if (old_v<amount) { showToast('Insufficient balance','error'); return; } new_v = old_v - amount; }
  else if (op_type==='transfer') { if (!target_acc) { showToast('Target account needed','error'); return; } new_v = old_v - amount; }
  else new_v = amount;
  const lk = await apiPost('/actions/lock/acquire', { transaction_id:txn_id, account_id, lock_type:'X' });
  if (!lk.success) { showToast(`Lock ${lk.status}`, 'error'); setResult(lk); loadLockTable(); return; }
  const r = await apiPost('/actions/transaction/write', { transaction_id:txn_id, account_id, old_value:old_v, new_value:new_v });
  setResult(r);
  if (r.success && op_type==='transfer' && target_acc) {
    const tr = await apiPost('/actions/transaction/read', { transaction_id:txn_id, account_id:target_acc });
    if (tr.success) { await apiPost('/actions/lock/acquire',{transaction_id:txn_id,account_id:target_acc,lock_type:'X'}); await apiPost('/actions/transaction/write',{transaction_id:txn_id,account_id:target_acc,old_value:tr.balance,new_value:tr.balance+amount}); }
  }
  showToast(r.success ? `Write: ₹${old_v}→₹${new_v}` : r.error, r.success?'success':'error'); loadLockTable();
}
async function txnCommit() {
  const {txn_id} = getTxn(); if (!txn_id) { showToast('TXN ID needed','error'); return; }
  const r = await apiPost('/actions/transaction/commit', { transaction_id:txn_id });
  await apiPost('/actions/lock/release-all', { transaction_id:txn_id });
  setResult(r); showToast(`${txn_id} committed ✓`,'success'); loadAccounts(); loadLockTable(); loadScheduleLog();
}
async function txnRollback() {
  const {txn_id} = getTxn(); if (!txn_id) { showToast('TXN ID needed','error'); return; }
  const r = await apiPost('/actions/transaction/rollback', { transaction_id:txn_id });
  await apiPost('/actions/lock/release-all', { transaction_id:txn_id });
  setResult(r); showToast(`${txn_id} rolled back`,'error'); loadAccounts(); loadLockTable(); loadScheduleLog();
}

// ─── Panel 3: Lock Table ────────────────────────────────────────────
async function loadLockTable() {
  const d = await apiGet('/actions/lock/table');
  const tb = document.querySelector('#lock-table tbody'); tb.innerHTML = '';
  if (!d.locks||!d.locks.length) { tb.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:14px">No active locks</td></tr>'; return; }
  d.locks.forEach(l => {
    const r = document.createElement('tr'); r.className = `row-${l.status}`;
    r.innerHTML = `<td class="mono">${l.data_item}</td><td><span class="tag tag-${l.lock_type}">${l.lock_type==='S'?'🔓 S':'🔒 X'}</span></td><td class="mono" style="color:var(--accent)">${l.transaction_id}</td><td><span class="tag tag-${l.status}">${l.status}</span></td>`;
    tb.appendChild(r);
  });
}

// ─── Data Sync ──────────────────────────────────────────────────────
async function refreshData() {
  await Promise.all([loadAccounts(), loadLockTable(), loadScheduleLog()]);
}

// ─── Panel 4: Schedule Log ──────────────────────────────────────────
async function loadScheduleLog() {
  const d = await apiGet('/actions/schedules');
  const box = document.getElementById('schedule-log');
  if (!d.schedules||!d.schedules.length) { box.innerHTML='<div style="color:var(--muted);padding:16px;text-align:center">No entries yet</div>'; return; }
  box.innerHTML = d.schedules.slice(-120).map(e => {
    const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '--';
    const op = (e.operation||'').toLowerCase();
    const val = (e.old_value!=null&&e.new_value!=null) ? `${e.old_value}→${e.new_value}` : (e.new_value!=null ? String(e.new_value) : '');
    const cls = op==='commit'?'log-commit':op==='abort'?'log-abort':'';
    const retryTag = e.retry_count ? `<span class="tag tag-retry" title="MongoDB Write Retries">🔄 ${e.retry_count}</span>` : '';
    return `<div class="log-entry ${cls}"><span class="log-ts">${ts}</span><span class="log-txn">${e.transaction_id}</span><span class="log-op op-${op}">${op.toUpperCase()}</span><span class="log-item">${e.data_item||''}</span><span class="log-vals">${val}</span>${retryTag}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

// ─── Panel 5: Deadlock ──────────────────────────────────────────────
async function autoCheckDeadlock() {
  const strategy = document.getElementById('victim-strategy').value;
  const res = await apiGet(`/actions/deadlock/auto-check?threshold=3&strategy=${strategy}`);
  const statusEl = document.getElementById('auto-check-status');
  
  if (res.triggered) {
    const cd = res.deadlock_result.cycle_detection, graph = res.deadlock_result.wait_for_graph||{};
    const cycleNodes = cd?.cycle_found ? cd.cycle_path : [];
    const victim = res.deadlock_result.resolution?.victim || null;
    const box = document.getElementById('deadlock-result');
    
    box.innerHTML = `<div class="deadlock-cycle pulse">🤖 AUTO-TRIGGERED RESOLUTION</div><div>Reason: ${res.reason}</div><div class="deadlock-victim">⚡ Victim: ${victim} (${res.deadlock_result.resolution.strategy_used})</div>`;
    showToast(`Auto-resolved deadlock! Victim: ${victim}`, 'success');
    
    renderWaitForGraph(graph, 'wfg-canvas', { cycleNodes, victim });
    loadLockTable(); loadScheduleLog(); loadAccounts();
    
    if (statusEl) {
      statusEl.textContent = 'Auto-Check: Active (Triggered!)';
      statusEl.classList.add('active');
      setTimeout(() => statusEl.classList.remove('active'), 2000);
    }
  } else {
    if (statusEl) {
      statusEl.textContent = 'Auto-Check: Active';
      statusEl.classList.remove('active');
    }
  }
}

async function checkDeadlock() {
  const strategy = document.getElementById('victim-strategy').value;
  const res = await apiGet(`/actions/deadlock/check?strategy=${strategy}`);
  const box = document.getElementById('deadlock-result');
  const cd = res.cycle_detection, graph = res.wait_for_graph||{};
  const cycleNodes = cd?.cycle_found ? cd.cycle_path : [];
  const victim = res.resolution?.victim || null;
  if (cd?.cycle_found) {
    box.innerHTML = `<div class="deadlock-cycle">🔴 DEADLOCK DETECTED!</div><div>Cycle: ${cd.cycle_path.join(' → ')}</div><div class="deadlock-victim">⚡ Victim: ${victim} (${res.resolution.strategy_used})</div>`;
    showToast(`Deadlock! Victim: ${victim} (${res.resolution.strategy_used})`,'error');
  } else {
    box.innerHTML = `<div class="deadlock-ok">✅ No Deadlock Detected</div><div>WFG: ${JSON.stringify(graph)}</div>`;
    showToast('No deadlock','success');
  }
  renderWaitForGraph(graph, 'wfg-canvas', { cycleNodes, victim });
  loadLockTable(); loadScheduleLog();
}
async function showGraph() {
  const d = await apiGet('/actions/deadlock/graph');
  renderWaitForGraph(d.wait_for_graph||{}, 'wfg-canvas');
}

async function simulateDeadlock() {
  if (demoRunning) return; setDemoRunning(true);
  showToast('Setting up T1↔T2 circular wait...','info');
  for (const t of ['T1','T2']) { await apiPost('/actions/lock/release-all',{transaction_id:t}); await apiPost('/actions/transaction/rollback',{transaction_id:t}); }
  await apiPost('/actions/transaction/begin',{transaction_id:'T1',txn_type:'transfer'});
  await apiPost('/actions/transaction/begin',{transaction_id:'T2',txn_type:'transfer'});
  await apiPost('/actions/lock/acquire',{transaction_id:'T1',account_id:'ACC1001',lock_type:'X'}); await sleep(400);
  await apiPost('/actions/lock/acquire',{transaction_id:'T2',account_id:'ACC1002',lock_type:'X'}); await sleep(400);
  await apiPost('/actions/lock/acquire',{transaction_id:'T1',account_id:'ACC1002',lock_type:'X'}); await sleep(400);
  await apiPost('/actions/lock/acquire',{transaction_id:'T2',account_id:'ACC1001',lock_type:'X'});
  loadLockTable(); setDemoRunning(false);
  showToast('Deadlock created! Click Check Deadlock','info');
}

// ─── Reset ──────────────────────────────────────────────────────────
async function resetSystem() {
  if (!confirm('Reset all locks, schedules, transactions and restore balances?')) return;
  const r = await apiPost('/actions/reset', {});
  if (r.success) { showToast('System reset ✓','success'); loadAccounts(); loadLockTable(); loadScheduleLog(); renderWaitForGraph({},'wfg-canvas'); document.getElementById('deadlock-result').textContent='Ready.'; document.getElementById('txn-result').textContent='Ready.'; }
  else showToast('Reset failed','error');
}

// ─── Demo 1: Serial Schedule ────────────────────────────────────────
async function demoSerial() {
  if (demoRunning) return; setDemoRunning(true);
  showToast('▶ Serial Schedule starting...','info');
  for (const t of ['DS1','DS2']) { await apiPost('/actions/lock/release-all',{transaction_id:t}); await apiPost('/actions/transaction/rollback',{transaction_id:t}); }
  // T1 fully
  await apiPost('/actions/transaction/begin',{transaction_id:'DS1',txn_type:'deposit'});
  await apiPost('/actions/lock/acquire',{transaction_id:'DS1',account_id:'ACC1001',lock_type:'X'});
  const r1 = await apiPost('/actions/transaction/read',{transaction_id:'DS1',account_id:'ACC1001'});
  showToast(`DS1 READ ACC1001=₹${r1.balance}`,'info'); await sleep(500);
  await apiPost('/actions/transaction/write',{transaction_id:'DS1',account_id:'ACC1001',old_value:r1.balance,new_value:r1.balance+500});
  await apiPost('/actions/transaction/commit',{transaction_id:'DS1'});
  await apiPost('/actions/lock/release-all',{transaction_id:'DS1'});
  showToast('DS1 COMMIT ✓','success'); await sleep(600);
  // T2 after T1
  await apiPost('/actions/transaction/begin',{transaction_id:'DS2',txn_type:'deposit'});
  await apiPost('/actions/lock/acquire',{transaction_id:'DS2',account_id:'ACC1001',lock_type:'X'});
  const r2 = await apiPost('/actions/transaction/read',{transaction_id:'DS2',account_id:'ACC1001'});
  showToast(`DS2 READ ACC1001=₹${r2.balance}`,'info'); await sleep(500);
  await apiPost('/actions/transaction/write',{transaction_id:'DS2',account_id:'ACC1001',old_value:r2.balance,new_value:r2.balance+500});
  await apiPost('/actions/transaction/commit',{transaction_id:'DS2'});
  await apiPost('/actions/lock/release-all',{transaction_id:'DS2'});
  showToast('DS2 COMMIT ✓ — Serial done!','success');
  loadAccounts(); loadLockTable(); loadScheduleLog(); setDemoRunning(false);
}

// ─── Demo 2: Concurrent Schedule ────────────────────────────────────
async function demoConcurrent() {
  if (demoRunning) return; setDemoRunning(true);
  showToast('▶ Concurrent Schedule starting...','info');
  for (const t of ['DC1','DC2']) { await apiPost('/actions/lock/release-all',{transaction_id:t}); await apiPost('/actions/transaction/rollback',{transaction_id:t}); }
  await apiPost('/actions/transaction/begin',{transaction_id:'DC1',txn_type:'transfer'});
  await apiPost('/actions/transaction/begin',{transaction_id:'DC2',txn_type:'transfer'});
  showToast('DC1 & DC2 BEGIN','info'); await sleep(400);
  await apiPost('/actions/lock/acquire',{transaction_id:'DC1',account_id:'ACC1001',lock_type:'S'});
  await apiPost('/actions/lock/acquire',{transaction_id:'DC2',account_id:'ACC1002',lock_type:'S'});
  showToast('S locks acquired','info'); await sleep(400);
  await apiPost('/actions/transaction/read',{transaction_id:'DC1',account_id:'ACC1001'});
  await apiPost('/actions/transaction/read',{transaction_id:'DC2',account_id:'ACC1002'});
  await sleep(400);
  const l1 = await apiPost('/actions/lock/acquire',{transaction_id:'DC1',account_id:'ACC1002',lock_type:'X'});
  showToast(`DC1 X on ACC1002 → ${l1.status}`, l1.success?'info':'error'); await sleep(400);
  const l2 = await apiPost('/actions/lock/acquire',{transaction_id:'DC2',account_id:'ACC1001',lock_type:'X'});
  showToast(`DC2 X on ACC1001 → ${l2.status}`, l2.success?'info':'error');
  loadLockTable(); loadScheduleLog(); setDemoRunning(false);
  showToast('Concurrent schedule — check lock conflicts!','info');
}

// ─── Demo 3: Deadlock + Auto Resolve ────────────────────────────────
async function demoDeadlockResolve() {
  if (demoRunning) return; setDemoRunning(true);
  showToast('▶ Deadlock + Resolve starting...','info');
  for (const t of ['T1','T2']) { await apiPost('/actions/lock/release-all',{transaction_id:t}); await apiPost('/actions/transaction/rollback',{transaction_id:t}); }
  await apiPost('/actions/transaction/begin',{transaction_id:'T1',txn_type:'transfer'});
  await apiPost('/actions/transaction/begin',{transaction_id:'T2',txn_type:'transfer'});
  await apiPost('/actions/lock/acquire',{transaction_id:'T1',account_id:'ACC1001',lock_type:'X'});
  await apiPost('/actions/lock/acquire',{transaction_id:'T2',account_id:'ACC1002',lock_type:'X'});
  await apiPost('/actions/lock/acquire',{transaction_id:'T1',account_id:'ACC1002',lock_type:'X'});
  await apiPost('/actions/lock/acquire',{transaction_id:'T2',account_id:'ACC1001',lock_type:'X'});
  loadLockTable(); await sleep(800);
  showToast('Running deadlock check...','info'); await sleep(500);
  const res = await apiGet('/actions/deadlock/check');
  const cd = res.cycle_detection, graph = res.wait_for_graph||{};
  const cycleNodes = cd?.cycle_found?cd.cycle_path:[], victim = res.resolution?.victim||null;
  const box = document.getElementById('deadlock-result');
  if (cd?.cycle_found) {
    box.innerHTML = `<div class="deadlock-cycle">🔴 DEADLOCK DETECTED & RESOLVED!</div><div>Cycle: ${cd.cycle_path.join('→')}</div><div class="deadlock-victim">⚡ Victim: ${victim}</div>`;
    showToast(`Resolved! Victim: ${victim}`,'success');
  } else { box.innerHTML = `<div class="deadlock-ok">✅ No Deadlock</div>`; }
  renderWaitForGraph(graph, 'wfg-canvas', { cycleNodes, victim });
  loadAccounts(); loadLockTable(); loadScheduleLog(); setDemoRunning(false);
}

let preflightLocks = [];

function addPreflightLock() {
  const acc = document.getElementById('pre-acc-id').value.trim();
  const type = document.getElementById('pre-lock-type').value;
  if (!acc) return showToast('Account ID required', 'error');
  
  preflightLocks.push({ account_id: acc, lock_type: type });
  renderPreflightList();
  document.getElementById('pre-acc-id').value = '';
}

function renderPreflightList() {
  const list = document.getElementById('preflight-list');
  if (preflightLocks.length === 0) {
    list.innerHTML = '<em>No locks added to check list yet.</em>';
    return;
  }
  list.innerHTML = preflightLocks.map((l, i) => `
    <div class="pre-lock-item" style="display:inline-flex;align-items:center;background:var(--surface);padding:4px 8px;border-radius:4px;margin-right:6px;margin-bottom:6px;border:1px solid var(--border)">
      <span class="tag tag-${l.lock_type}" style="margin-right:6px">${l.lock_type}</span>
      <span class="mono" style="margin-right:8px">${l.account_id}</span>
      <span style="cursor:pointer;opacity:0.6" onclick="removePreflightLock(${i})">×</span>
    </div>
  `).join('');
}

function removePreflightLock(idx) {
  preflightLocks.splice(idx, 1);
  renderPreflightList();
}

async function runPreflight() {
  const statusEl = document.getElementById('preflight-status');
  const conflictArea = document.getElementById('preflight-conflicts');
  
  if (preflightLocks.length === 0) {
    statusEl.innerHTML = '<span style="color:var(--muted)">List is empty.</span>';
    return;
  }

  statusEl.innerHTML = '<span class="pulse">⏳ Verifying...</span>';
  conflictArea.style.display = 'none';

  const res = await apiPost('/actions/preflight', { locks_needed: preflightLocks });
  
  if (res.ready) {
    statusEl.innerHTML = '<span style="color:var(--accent2)">✅ All locks available — safe to proceed</span>';
    showToast('Readiness Check: SUCCESS', 'success');
  } else {
    statusEl.innerHTML = '<span style="color:var(--accent)">❌ Conflicts detected</span>';
    showToast('Readiness Check: CONFLICTS', 'error');
    
    conflictArea.innerHTML = `
      <table class="tbl-sm" style="width:100%;font-size:10px;background:var(--surface);border-radius:4px">
        <thead><tr style="opacity:0.6"><th>Account</th><th>Held By</th><th>Lock</th><th>Status</th></tr></thead>
        <tbody>
          ${res.conflicts.map(c => `
            <tr><td class="mono">${c.account_id}</td><td class="mono" style="color:var(--accent)">${c.held_by}</td><td><span class="tag tag-${c.lock_type}">${c.lock_type}</span></td><td>${c.status}</td></tr>
          `).join('')}
        </tbody>
      </table>
    `;
    conflictArea.style.display = 'block';
  }
  
  preflightLocks = [];
  renderPreflightList();
}

async function validateSchedule() {
  const input = document.getElementById('validate-txns').value.trim();
  const resEl = document.getElementById('validation-result');
  const graphContainer = document.getElementById('precedence-graph-container');
  
  if (!input) return showToast('Enter transaction IDs', 'error');
  
  const ids = input.split(',').map(s => s.trim()).filter(s => s.length > 0);
  if (ids.length === 0) return;

  resEl.innerHTML = '<span class="pulse">🧪 Analyzing schedule...</span>';
  graphContainer.innerHTML = '';

  const res = await apiPost('/actions/validate-schedule', { transaction_ids: ids });
  
  if (!res.success) {
    resEl.innerHTML = `<span style="color:var(--accent)">❌ Error: ${res.error}</span>`;
    return;
  }

  const v = res.validation;
  if (v.result === 'SERIALIZABLE') {
    resEl.innerHTML = '<span style="color:var(--accent2)">✅ CONFLICT SERIALIZABLE — safe execution</span>';
    showToast('Schedule is Serializable', 'success');
  } else {
    const cycle = v.cycle_edge ? `${v.cycle_edge[0]} → ${v.cycle_edge[1]}` : 'detected';
    resEl.innerHTML = `<span style="color:var(--accent)">❌ NOT SERIALIZABLE — cycle at [${cycle}]</span>`;
    showToast('Non-Serializable Schedule!', 'error');
  }

  renderPrecedenceGraph(v.graph, 'precedence-graph-container', v.result);
}

// ─── Init ───────────────────────────────────────────────────────────
// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    refreshData();
    setInterval(refreshData, 3000); // 3s for dashboard
    setInterval(autoCheckDeadlock, 5000); // 5s for auto-deadlock

  document.getElementById('demo-indicator').style.display = 'none';
  document.getElementById('txn-op').addEventListener('change', e => {
    document.getElementById('txn-target-group').style.display = e.target.value==='transfer'?'flex':'none';
  });
});
