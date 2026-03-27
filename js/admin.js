// js/admin.js — Admin dashboard logic
import { db, auth } from '/firebase-config.js';
import {
  collection, doc, getDoc, getDocs, updateDoc, query,
  where, orderBy, onSnapshot, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js';
import {
  applyConfig, showToast, escapeHTML, formatCurrency, formatRelativeTime
} from '/js/utils.js';
import { initAuth } from '/js/auth.js';

export function initAdminDashboard() {
  applyConfig();
  initAuth();

  // Guard: admin-only access.
  // Exception: if the "psychosis" easter egg was used to get here, skip the
  // isAdmin check and grant dev access for the duration of this browser session.
  const devAccess = sessionStorage.getItem('hmsbay_dev_access') === '1';

  if (devAccess) {
    // Bootstrap immediately — no auth gate, dev/testing mode.
    loadAdminStats();
    loadAuctionTable();
    loadUserTable();
    loadKillSwitch();
    setupSidebarNav();
    const nameEl = document.getElementById('admin-user-name');
    if (nameEl) nameEl.textContent = auth.currentUser?.displayName || 'Dev Access';
    return;
  }

  // Normal path: wait for Firebase to restore the persisted session (avoids the
  // race where onAuthStateChanged fires null on first tick and boots a real admin).
  auth.authStateReady().then(async () => {
    const user = auth.currentUser;
    if (!user) { window.location.href = '/'; return; }

    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists() || !snap.data().isAdmin) {
      window.location.href = '/';
      return;
    }

    // Admin confirmed — bootstrap dashboard
    loadAdminStats();
    loadAuctionTable();
    loadUserTable();
    loadKillSwitch();
    setupSidebarNav();

    document.getElementById('admin-user-name').textContent = user.displayName || user.email;
  });
}

// ── Sidebar navigation ────────────────────────────────────────
function setupSidebarNav() {
  document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.section)?.classList.add('active');
    });
  });
}

// ── Stats ──────────────────────────────────────────────────────
async function loadAdminStats() {
  try {
    const [listingsSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, 'listings')),
      getDocs(collection(db, 'users'))
    ]);

    const listings = listingsSnap.docs.map(d => d.data());
    const active   = listings.filter(l => l.status === 'active').length;
    const ended    = listings.filter(l => l.status === 'ended').length;
    const users    = usersSnap.size;
    const bids     = listings.reduce((sum, l) => sum + (l.bids?.length || 0), 0);

    setText('stat-total-listings', listings.length);
    setText('stat-active-listings', active);
    setText('stat-total-users', users);
    setText('stat-total-bids', bids);
  } catch(e) { console.error(e); }
}

// ── Auction Management Table ───────────────────────────────────
function loadAuctionTable() {
  const tbody    = document.getElementById('auction-tbody');
  const filterEl = document.getElementById('auction-filter-status');
  let allListings = [];

  if (!tbody) return;

  onSnapshot(collection(db, 'listings'), snap => {
    allListings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAuctionTable(allListings, tbody, filterEl?.value || 'all');
  });

  filterEl?.addEventListener('change', () => {
    renderAuctionTable(allListings, tbody, filterEl.value);
  });
}

function renderAuctionTable(listings, tbody, statusFilter) {
  let items = [...listings].sort((a,b) => tsMs(b.startTime) - tsMs(a.startTime));
  if (statusFilter !== 'all') items = items.filter(l => l.status === statusFilter);

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:24px">No listings found.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(l => {
    const price    = l.currentBid || l.startingPrice || 0;
    const endDate  = l.endTime ? new Date(tsMs(l.endTime)).toLocaleString() : '—';
    const badgeCls = l.status === 'active' ? 'badge-active' : l.status === 'ended' ? 'badge-ended' : 'badge-cancelled';

    return `
      <tr>
        <td><a href="/listing.html?id=${escapeHTML(l.id)}" target="_blank" style="font-weight:600">${escapeHTML(l.title || 'Untitled')}</a></td>
        <td>${escapeHTML(l.sellerName || '—')}</td>
        <td>${formatCurrency(price)}</td>
        <td>${escapeHTML(endDate)}</td>
        <td><span class="badge ${badgeCls}">${escapeHTML(l.status)}</span></td>
        <td>
          <div class="td-actions">
            <a href="/listing.html?id=${escapeHTML(l.id)}" target="_blank" class="btn btn-ghost btn-sm">View</a>
            ${l.status === 'active' ? `
              <button class="btn btn-ghost btn-sm" onclick="window.__adminExtend('${escapeHTML(l.id)}')">+24h</button>
              <button class="btn btn-danger btn-sm" onclick="window.__adminCancel('${escapeHTML(l.id)}','${escapeHTML(l.title || '')}')">Cancel</button>
            ` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');
}

window.__adminCancel = async function(listingId, title) {
  if (!confirm(`Cancel listing "${title}"?`)) return;
  try {
    await updateDoc(doc(db, 'listings', listingId), { status: 'cancelled' });
    showToast('Listing cancelled.', 'success');
  } catch(e) { showToast('Failed to cancel.', 'error'); }
};

window.__adminExtend = async function(listingId) {
  try {
    const snap = await getDoc(doc(db, 'listings', listingId));
    const current = snap.data()?.endTime;
    const base = current ? tsMs(current) : Date.now();
    const newEnd = Timestamp.fromMillis(base + 86400 * 1000);
    await updateDoc(doc(db, 'listings', listingId), { endTime: newEnd });
    showToast('Extended by 24 hours.', 'success');
  } catch(e) { showToast('Failed to extend.', 'error'); }
};

// ── User Moderation Table ──────────────────────────────────────
function loadUserTable() {
  const tbody   = document.getElementById('users-tbody');
  const searchEl = document.getElementById('user-search');
  let allUsers   = [];

  if (!tbody) return;

  onSnapshot(collection(db, 'users'), snap => {
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUserTable(allUsers, tbody, searchEl?.value || '');
  });

  searchEl?.addEventListener('input', () => {
    renderUserTable(allUsers, tbody, searchEl.value);
  });
}

function renderUserTable(users, tbody, search) {
  let items = [...users];
  if (search) {
    const s = search.toLowerCase();
    items = items.filter(u =>
      (u.displayName || '').toLowerCase().includes(s) ||
      (u.email || '').toLowerCase().includes(s)
    );
  }

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:24px">No users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(u => {
    const joined    = u.createdAt?.toDate?.()?.toLocaleDateString() || '—';
    const banned    = u.isBanned ? true : false;
    const adminBadge = u.isAdmin ? `<span class="badge badge-active" style="margin-left:4px">Admin</span>` : '';
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;flex-shrink:0">
              ${escapeHTML((u.displayName || u.email || '?')[0].toUpperCase())}
            </div>
            <span style="font-weight:600">${escapeHTML(u.displayName || '—')}</span>
            ${adminBadge}
          </div>
        </td>
        <td>${escapeHTML(u.email || '—')}</td>
        <td>${escapeHTML(joined)}</td>
        <td>${escapeHTML(u.school || '—')}</td>
        <td>
          <div class="td-actions">
            ${banned
              ? `<button class="btn btn-ghost btn-sm" onclick="window.__adminUnban('${escapeHTML(u.uid || u.id)}')">Unban</button>`
              : `<button class="btn btn-danger btn-sm" onclick="window.__adminBan('${escapeHTML(u.uid || u.id)}','${escapeHTML(u.displayName || u.email || '')}')">Ban</button>`
            }
            ${!u.isAdmin
              ? `<button class="btn btn-ghost btn-sm" onclick="window.__adminMakeAdmin('${escapeHTML(u.uid || u.id)}','${escapeHTML(u.displayName || '')}')">Make Admin</button>`
              : ''
            }
          </div>
        </td>
      </tr>`;
  }).join('');
}

window.__adminBan = async function(uid, name) {
  if (!confirm(`Ban user "${name}"? They will be unable to log in or bid.`)) return;
  try {
    await updateDoc(doc(db, 'users', uid), { isBanned: true });
    showToast(`User "${name}" banned.`, 'success');
  } catch(e) { showToast('Failed to ban user.', 'error'); }
};

window.__adminUnban = async function(uid) {
  try {
    await updateDoc(doc(db, 'users', uid), { isBanned: false });
    showToast('User unbanned.', 'success');
  } catch(e) { showToast('Failed to unban.', 'error'); }
};

window.__adminMakeAdmin = async function(uid, name) {
  if (!confirm(`Grant admin privileges to "${name}"?`)) return;
  try {
    await updateDoc(doc(db, 'users', uid), { isAdmin: true });
    showToast(`"${name}" is now an admin.`, 'success');
  } catch(e) { showToast('Failed to update.', 'error'); }
};

// ── Kill Switch ────────────────────────────────────────────────
function loadKillSwitch() {
  const settingsRef = doc(db, 'siteSettings', 'global');

  onSnapshot(settingsRef, snap => {
    const data     = snap.exists() ? snap.data() : {};
    const active   = data.killSwitchActive || false;
    const msg      = data.maintenanceMessage || '';
    const track    = document.getElementById('kill-switch-track');
    const label    = document.getElementById('kill-switch-label');
    const msgInput = document.getElementById('kill-switch-message');
    const card     = document.getElementById('kill-switch-card');

    if (track)    { track.className = `toggle-track ${active ? 'on' : ''}`; }
    if (label)    { label.textContent = active ? 'Kill Switch ACTIVE — Site is in maintenance mode' : 'Kill Switch Off — Site is live'; }
    if (msgInput) { msgInput.value = msg; }
    if (card)     { card.className = `kill-switch-card ${active ? 'active-danger' : ''}`; }
  });

  document.getElementById('kill-switch-track')?.addEventListener('click', async () => {
    try {
      const snap  = await getDoc(settingsRef);
      const cur   = snap.exists() ? snap.data().killSwitchActive : false;
      const newVal = !cur;
      if (newVal && !confirm('Enable the kill switch? This will show a maintenance page to all visitors.')) return;
      await updateDoc(settingsRef, { killSwitchActive: newVal });
      showToast(newVal ? 'Kill switch enabled.' : 'Kill switch disabled. Site is live.', newVal ? 'warning' : 'success');
    } catch(e) {
      // If document doesn't exist, create it
      try {
        const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js');
        await setDoc(settingsRef, { killSwitchActive: true, maintenanceMessage: '' });
      } catch(e2) { showToast('Failed to toggle kill switch.', 'error'); }
    }
  });

  document.getElementById('save-maintenance-msg')?.addEventListener('click', async () => {
    const msg = document.getElementById('kill-switch-message')?.value || '';
    try {
      await updateDoc(settingsRef, { maintenanceMessage: msg });
      showToast('Maintenance message saved.', 'success');
    } catch(e) { showToast('Failed to save.', 'error'); }
  });

  // Process expired auctions manually
  document.getElementById('process-expired-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('process-expired-btn');
    btn.disabled = true; btn.textContent = 'Processing…';
    try {
      const res = await fetch('/api/process-expired-auctions', { method: 'POST' });
      const data = await res.json();
      showToast(`Processed ${data.processed || 0} expired auctions.`, 'success');
    } catch(e) {
      showToast('Backend unavailable. Make sure Flask is running.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Process Expired Auctions';
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────
function tsMs(ts) {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return Number(ts);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
