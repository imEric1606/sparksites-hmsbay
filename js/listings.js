// js/listings.js — Listing CRUD, bidding, real-time feeds
import { db, storage } from '/firebase-config.js';
import {
  collection, doc, setDoc, addDoc, getDoc, getDocs, updateDoc,
  onSnapshot, query, where, limit,
  serverTimestamp, Timestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import {
  ref, uploadBytesResumable, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-storage.js';
import { SITE_CONFIG } from '/config.js';
import {
  applyConfig, formatTimeRemaining, formatCurrency,
  formatRelativeTime, showToast, showLoading,
  sanitizeInput, escapeHTML, getQueryParam, tickCountdown, debounce
} from '/js/utils.js';
import { initAuth, getCurrentUser, getCurrentUserDoc, checkKillSwitch, onAuthChange } from '/js/auth.js';
import { createAuctionMessageThread } from '/js/messages.js';

// ═══════════════════════════════════════════════════════════════
//  INDEX PAGE  (called from index.html)
// ═══════════════════════════════════════════════════════════════
export function initIndexPage() {
  applyConfig();
  initAuth();
  checkKillSwitch();
  populateCategoryFilter();

  let allListings = [];
  let filterCategory = 'all';
  let filterSort     = 'ending';
  let searchQuery    = '';

  const grid      = document.getElementById('listings-grid');
  const countEl   = document.getElementById('results-count');
  const searchInput = document.getElementById('search-input');

  // Real-time listener for active listings.
  // No orderBy here — compound index not required, sorting is done client-side.
  const q = query(
    collection(db, 'listings'),
    where('status', '==', 'active'),
    limit(80)
  );

  grid.innerHTML = renderSkeletons(6);

  const unsub = onSnapshot(q, snap => {
    allListings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGrid();
  }, err => {
    console.error(err);
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">⚠️</div>
      <h3>Couldn't load listings</h3>
      <p>Check your connection and try refreshing.</p>
    </div>`;
  });

  // Filters
  document.getElementById('filter-category')?.addEventListener('change', e => {
    filterCategory = e.target.value;
    renderGrid();
  });
  document.getElementById('filter-sort')?.addEventListener('change', e => {
    filterSort = e.target.value;
    renderGrid();
  });

  // Search — listings + users
  const handleSearch = debounce(val => {
    searchQuery = val.toLowerCase().trim();
    renderGrid();
    renderUserResults(searchQuery);
  }, 250);

  if (searchInput) {
    searchInput.addEventListener('input', e => handleSearch(e.target.value));
    const navSearch = document.getElementById('nav-search-input');
    navSearch?.addEventListener('input', e => {
      searchInput.value = e.target.value;
      handleSearch(e.target.value);
    });
  }

  function renderGrid() {
    let items = [...allListings];

    // Filter by category
    if (filterCategory !== 'all') {
      items = items.filter(l => l.category === filterCategory);
    }
    // Search
    if (searchQuery) {
      items = items.filter(l =>
        (l.title || '').toLowerCase().includes(searchQuery) ||
        (l.description || '').toLowerCase().includes(searchQuery)
      );
    }
    // Sort
    switch (filterSort) {
      case 'ending':  items.sort((a,b) => tsMs(a.endTime) - tsMs(b.endTime)); break;
      case 'price-asc':  items.sort((a,b) => (a.currentBid||a.startingPrice) - (b.currentBid||b.startingPrice)); break;
      case 'price-desc': items.sort((a,b) => (b.currentBid||b.startingPrice) - (a.currentBid||a.startingPrice)); break;
      case 'newest':  items.sort((a,b) => tsMs(b.startTime) - tsMs(a.startTime)); break;
    }

    if (countEl) countEl.textContent = `${items.length} listing${items.length !== 1 ? 's' : ''}`;

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🔍</div>
        <h3>No listings found</h3>
        <p>Try adjusting your search or filters.</p>
      </div>`;
      return;
    }

    grid.innerHTML = items.map(renderListingCard).join('');
    startCountdowns();
  }
}

function renderListingCard(listing) {
  const endMs   = tsMs(listing.endTime);
  const { text, urgent, warning, ended } = formatTimeRemaining(endMs);
  const price   = listing.currentBid || listing.startingPrice || 0;
  const bidCount = (listing.bids || []).length;
  const imgHTML = listing.imageURL
    ? `<img src="${escapeHTML(listing.imageURL)}" alt="${escapeHTML(listing.title)}" loading="lazy">`
    : `<div class="no-image">📦</div>`;
  const badge = ended
    ? `<span class="badge badge-ended">Ended</span>`
    : `<span class="badge badge-active">Active</span>`;

  return `
    <div class="listing-card ${ended ? 'ended' : ''}"
         onclick="window.location.href='/listing.html?id=${escapeHTML(listing.id)}'"
         role="link" tabindex="0"
         onkeydown="if(event.key==='Enter')window.location.href='/listing.html?id=${escapeHTML(listing.id)}'">
      <div class="listing-card-image">${imgHTML}</div>
      <div class="listing-card-body">
        <div class="listing-card-title">${escapeHTML(listing.title || 'Untitled')}</div>
        <div class="listing-card-seller">by ${escapeHTML(listing.sellerName || 'Unknown')}</div>
        <div class="listing-card-price">
          ${formatCurrency(price)}
          <span>${bidCount} bid${bidCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="listing-card-footer">
        ${badge}
        <span class="countdown${urgent ? ' urgent' : warning ? ' warning' : ended ? ' ended' : ''}"
              data-endms="${endMs}" data-listingid="${escapeHTML(listing.id)}">
          ⏱ ${ended ? 'Ended' : text}
        </span>
      </div>
    </div>`;
}

function renderSkeletons(n) {
  return Array.from({ length: n }, () => `
    <div class="listing-card">
      <div class="listing-card-image skeleton" style="height:200px"></div>
      <div class="listing-card-body" style="gap:8px">
        <div class="skeleton" style="height:18px;width:80%"></div>
        <div class="skeleton" style="height:14px;width:50%"></div>
        <div class="skeleton" style="height:24px;width:40%;margin-top:8px"></div>
      </div>
    </div>`).join('');
}

function startCountdowns() {
  document.querySelectorAll('.countdown[data-endms]').forEach(el => {
    const endMs     = parseInt(el.dataset.endms, 10);
    const listingId = el.dataset.listingid;
    tickCountdown(el, endMs);
    const iv = setInterval(() => {
      tickCountdown(el, endMs);
      if (Date.now() >= endMs) {
        clearInterval(iv);
        el.closest('.listing-card')?.classList.add('ended');
        const badge = el.closest('.listing-card')?.querySelector('.badge');
        if (badge) { badge.className = 'badge badge-ended'; badge.textContent = 'Ended'; }
        // Write 'ended' status to Firestore so the homepage feed drops it
        // and the profile sold/won tabs pick it up in real time.
        if (listingId) expireListingInFirestore(listingId);
      }
    }, 1000);
  });
}

// Idempotent — silently skips if already ended or rules deny it.
async function expireListingInFirestore(listingId) {
  try {
    await updateDoc(doc(db, 'listings', listingId), { status: 'ended' });
  } catch(e) {
    // Firestore rules may restrict this to admins/backend — that's fine.
    if (e.code !== 'permission-denied') console.warn('expireListing:', e.code);
  }
}

// Searches users by displayName / email and renders matching cards above the grid.
// Fetches once per search term (small school dataset — client-side filter is fine).
let _userCache = null;
async function renderUserResults(query) {
  const section = document.getElementById('user-results-section');
  const grid    = document.getElementById('user-results-grid');
  if (!section || !grid) return;

  if (!query) { section.style.display = 'none'; return; }

  // Lazy-load the full users list once per page session
  if (!_userCache) {
    try {
      const snap = await getDocs(collection(db, 'users'));
      _userCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch(e) {
      console.warn('User search unavailable:', e.code);
      _userCache = [];
    }
  }

  const matches = _userCache.filter(u =>
    (u.displayName || '').toLowerCase().includes(query) ||
    (u.email || '').toLowerCase().includes(query) ||
    (u.school || '').toLowerCase().includes(query)
  );

  if (!matches.length) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  grid.innerHTML = matches.map(u => {
    const initials = (u.displayName || u.email || '?')[0].toUpperCase();
    return `
      <a href="/profile.html?uid=${escapeHTML(u.uid)}" class="user-chip">
        <div class="user-chip-avatar">${escapeHTML(initials)}</div>
        <div class="user-chip-info">
          <div class="user-chip-name">${escapeHTML(u.displayName || 'Unknown')}</div>
          ${u.school ? `<div class="user-chip-school">${escapeHTML(u.school)}</div>` : ''}
        </div>
      </a>`;
  }).join('');
}

function populateCategoryFilter() {
  const sel = document.getElementById('filter-category');
  if (!sel) return;
  SITE_CONFIG.categories.forEach(cat => {
    const o = document.createElement('option');
    o.value = cat; o.textContent = cat;
    sel.appendChild(o);
  });
}

// ═══════════════════════════════════════════════════════════════
//  LISTING DETAIL PAGE
// ═══════════════════════════════════════════════════════════════
export async function initListingPage() {
  applyConfig();
  initAuth();
  checkKillSwitch();

  const listingId = getQueryParam('id');
  if (!listingId) { show404(); return; }

  const listingRef = doc(db, 'listings', listingId);
  let countdownInterval = null;

  // Real-time listener
  onSnapshot(listingRef, snap => {
    if (!snap.exists()) { show404(); return; }
    const data = { id: snap.id, ...snap.data() };
    renderListingDetail(data);

    if (countdownInterval) clearInterval(countdownInterval);
    const endMs = tsMs(data.endTime);
    const timerEl = document.getElementById('detail-countdown');
    tickCountdown(timerEl, endMs);
    countdownInterval = setInterval(() => tickCountdown(timerEl, endMs), 1000);
  });
}

function renderListingDetail(listing) {
  const endMs     = tsMs(listing.endTime);
  const { ended } = formatTimeRemaining(endMs);
  const price     = listing.currentBid || listing.startingPrice || 0;
  const bids      = listing.bids || [];
  const user      = getCurrentUser();
  const userDoc   = getCurrentUserDoc();

  const titleEl = document.getElementById('listing-title');
  if (titleEl) titleEl.textContent = listing.title || 'Untitled';
  document.title = `${listing.title || 'Listing'} | HMSBay`;
  const breadcrumb = document.getElementById('breadcrumb-title');
  if (breadcrumb) breadcrumb.textContent = listing.title || 'Listing';

  // Image
  const imgBox = document.getElementById('listing-image-box');
  if (imgBox) {
    imgBox.innerHTML = listing.imageURL
      ? `<img src="${escapeHTML(listing.imageURL)}" alt="${escapeHTML(listing.title)}">`
      : `<div class="no-image-lg">📦</div>`;
  }

  // Meta badges
  const metaEl = document.getElementById('listing-meta');
  if (metaEl) {
    metaEl.innerHTML = `
      <span class="badge ${ended ? 'badge-ended' : 'badge-active'}">${ended ? 'Ended' : 'Active'}</span>
      <span class="badge badge-new">${escapeHTML(listing.condition || '')}</span>
      <span class="badge" style="background:var(--bg);color:var(--text-secondary)">${escapeHTML(listing.category || '')}</span>
    `;
  }

  // Description
  const descEl = document.getElementById('listing-description');
  if (descEl) descEl.textContent = listing.description || '';

  // Price box
  const priceBox = document.getElementById('price-box');
  if (priceBox) {
    priceBox.innerHTML = `
      <div class="price-label">${bids.length ? 'Current Bid' : 'Starting Price'}</div>
      <div class="price-amount">${formatCurrency(price)}</div>
      <div class="bid-count">${bids.length} bid${bids.length !== 1 ? 's' : ''} · Min next bid: ${formatCurrency(price + SITE_CONFIG.minBidIncrement)}</div>
    `;
  }

  // Bid area
  renderBidArea(listing, user, userDoc, ended);

  // Bid history
  renderBidHistory(bids);

  // Seller card
  const sellerEl = document.getElementById('seller-card');
  if (sellerEl) {
    const initials = (listing.sellerName || 'S')[0].toUpperCase();
    sellerEl.innerHTML = `
      <div class="seller-avatar">${escapeHTML(initials)}</div>
      <div class="seller-info">
        <strong><a href="/profile.html?uid=${escapeHTML(listing.sellerId)}">${escapeHTML(listing.sellerName || 'Unknown')}</a></strong>
        <small>Seller</small>
      </div>
    `;
  }
}

function renderBidArea(listing, user, userDoc, ended) {
  const bidArea = document.getElementById('bid-area');
  if (!bidArea) return;

  const price = listing.currentBid || listing.startingPrice || 0;
  const minBid = price + SITE_CONFIG.minBidIncrement;

  if (ended) {
    if (listing.currentBidderUid) {
      // Ensure a message thread exists between winner and seller (idempotent)
      createAuctionMessageThread(listing);

      const isWinner = user?.uid === listing.currentBidderUid;
      const isSeller = user?.uid === listing.sellerId;
      const winnerLabel = isWinner
        ? 'You won this auction!'
        : `Congratulations, ${escapeHTML(listing.currentBidderName || 'winner')}!`;
      const convBtn = (isWinner || isSeller)
        ? `<a href="/messages.html" class="btn btn-primary btn-block" style="margin-top:12px">💬 View Conversation</a>`
        : '';

      bidArea.innerHTML = `
        <div class="winner-box">
          <span class="trophy">🏆</span>
          <div>
            <strong>${winnerLabel}</strong>
            <div style="font-size:0.85rem;color:var(--text-secondary)">Winning bid: ${formatCurrency(listing.currentBid)}</div>
          </div>
        </div>
        ${convBtn}`;
    } else {
      bidArea.innerHTML = `<div class="ended-box"><strong>Auction Ended</strong><p>No bids were placed.</p></div>`;
    }
    return;
  }

  if (!user) {
    bidArea.innerHTML = `<button class="btn btn-primary btn-block" onclick="window.__authModal('login')">Log In to Bid</button>`;
    return;
  }
  if (userDoc?.isBanned) {
    bidArea.innerHTML = `<div class="ended-box" style="border-color:var(--error)">Your account is banned.</div>`;
    return;
  }
  if (listing.sellerId === user.uid) {
    bidArea.innerHTML = `<div class="ended-box">You are the seller of this item.</div>`;
    return;
  }

  bidArea.innerHTML = `
    <div class="bid-form">
      <div class="bid-input-row">
        <input type="number" id="bid-amount" placeholder="${formatCurrency(minBid)}"
               min="${minBid}" step="0.01" style="font-size:1.1rem">
        <button class="btn btn-accent btn-lg" id="place-bid-btn">Place Bid</button>
      </div>
      <div class="bid-hint">Minimum bid: ${formatCurrency(minBid)}</div>
      <div class="bid-error-msg" id="bid-error"></div>
    </div>
  `;

  document.getElementById('place-bid-btn').addEventListener('click', () =>
    handlePlaceBid(listing, user)
  );
}

async function handlePlaceBid(listing, user) {
  const input  = document.getElementById('bid-amount');
  const errEl  = document.getElementById('bid-error');
  const btn    = document.getElementById('place-bid-btn');
  const amount = parseFloat(input?.value);
  const price  = listing.currentBid || listing.startingPrice || 0;
  const minBid = price + SITE_CONFIG.minBidIncrement;

  errEl.className = 'bid-error-msg';

  if (!amount || isNaN(amount)) {
    errEl.textContent = 'Please enter a bid amount.'; errEl.className = 'bid-error-msg visible'; return;
  }
  if (amount < minBid) {
    errEl.textContent = `Bid must be at least ${formatCurrency(minBid)}.`; errEl.className = 'bid-error-msg visible'; return;
  }

  btn.disabled = true; btn.textContent = 'Placing bid…';
  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (userSnap.data()?.isBanned) { showToast('Your account is banned.', 'error'); return; }

    const bidEntry = {
      bidderUid:  user.uid,
      bidderName: user.displayName || user.email,
      amount,
      timestamp:  Timestamp.now()
    };

    await updateDoc(doc(db, 'listings', listing.id), {
      currentBid:        amount,
      currentBidderUid:  user.uid,
      currentBidderName: user.displayName || user.email,
      bids:              arrayUnion(bidEntry)
    });
    showToast(`Bid of ${formatCurrency(amount)} placed!`, 'success');
    if (input) input.value = '';
  } catch(e) {
    console.error(e);
    showToast('Failed to place bid. Try again.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Place Bid';
  }
}

function renderBidHistory(bids) {
  const container = document.getElementById('bid-history-body');
  if (!container) return;

  const sorted = [...bids].sort((a,b) => tsMs(b.timestamp) - tsMs(a.timestamp));

  if (!sorted.length) {
    container.innerHTML = '<div style="padding:14px 16px;color:var(--text-secondary);font-size:0.88rem">No bids yet.</div>';
    return;
  }

  container.innerHTML = `<div class="bid-list">
    ${sorted.map((b, i) => `
      <div class="bid-item ${i === 0 ? 'winning' : ''}">
        <div>
          <div class="bidder">${escapeHTML(b.bidderName || 'Anonymous')}</div>
          <div class="bid-time">${formatRelativeTime(tsMs(b.timestamp))}</div>
        </div>
        <div class="bid-amount">${formatCurrency(b.amount)}</div>
      </div>`).join('')}
  </div>`;

  // Accordion toggle
  document.getElementById('bid-history-toggle')?.addEventListener('click', () => {
    document.getElementById('bid-history-accordion')?.classList.toggle('open');
  });
}

// ═══════════════════════════════════════════════════════════════
//  CREATE LISTING PAGE
// ═══════════════════════════════════════════════════════════════
export function initCreateListingPage() {
  applyConfig();
  initAuth({ requireAuth: true });
  checkKillSwitch();

  onAuthChange((user) => {
    if (!user) return;
    populateCategorySelects();
    setupImageUpload();
    setupDurationOptions();

    document.getElementById('create-listing-form')?.addEventListener('submit', e => handleCreateListing(e, user));
  });
}

function populateCategorySelects() {
  ['listing-category', 'listing-condition'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const items = id === 'listing-category' ? SITE_CONFIG.categories : SITE_CONFIG.conditions;
    items.forEach(item => {
      const o = document.createElement('option');
      o.value = item; o.textContent = item;
      sel.appendChild(o);
    });
  });
}

function setupDurationOptions() {
  const sel = document.getElementById('listing-duration');
  if (!sel) return;
  SITE_CONFIG.auctionDurations.forEach(d => {
    const o = document.createElement('option');
    o.value = d.seconds; o.textContent = d.label;
    if (d.seconds === 86400) o.selected = true;
    sel.appendChild(o);
  });
}

function setupImageUpload() {
  const area    = document.getElementById('image-upload-area');
  const preview = document.getElementById('image-preview');
  const fileInput = document.getElementById('listing-image');
  const removeBtn = document.getElementById('remove-image');

  if (!area || !fileInput) return;

  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) previewImage(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) previewImage(fileInput.files[0]);
  });

  removeBtn?.addEventListener('click', () => {
    fileInput.value = '';
    preview.style.display = 'none';
    area.style.display = '';
  });

  function previewImage(file) {
    if (!file.type.startsWith('image/')) { showToast('Please select an image file.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      preview.querySelector('img').src = ev.target.result;
      preview.style.display = 'block';
      area.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
}

async function handleCreateListing(e, user) {
  e.preventDefault();
  const form = e.target;

  const title       = sanitizeInput(document.getElementById('listing-title').value);
  const description = sanitizeInput(document.getElementById('listing-description').value);
  const category    = document.getElementById('listing-category').value;
  const condition   = document.getElementById('listing-condition').value;
  const startPrice  = parseFloat(document.getElementById('listing-price').value);
  const duration    = parseInt(document.getElementById('listing-duration').value, 10);
  const imageFile   = document.getElementById('listing-image').files[0];

  if (!title)       { showToast('Title is required.', 'error'); return; }
  if (!description) { showToast('Description is required.', 'error'); return; }
  if (!category)    { showToast('Please select a category.', 'error'); return; }
  if (!condition)   { showToast('Please select a condition.', 'error'); return; }
  if (!startPrice || startPrice <= 0) { showToast('Enter a valid starting price.', 'error'); return; }
  if (!duration)    { showToast('Please select a duration.', 'error'); return; }

  const btn = form.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Creating…';
  showLoading(true);

  try {
    // Generate the doc reference (and its ID) without writing anything yet.
    // This avoids an orphaned placeholder document if the image upload later fails.
    const docRef    = doc(collection(db, 'listings'));
    const listingId = docRef.id;

    // Upload image first (if provided) — errors will be caught below
    let imageURL = '';
    if (imageFile) {
      btn.textContent = 'Uploading image…';
      imageURL = await uploadListingImage(imageFile, listingId);
    }

    btn.textContent = 'Saving listing…';
    const now     = Timestamp.now();
    const endTime = Timestamp.fromMillis(Date.now() + duration * 1000);

    // Write the complete document in one atomic setDoc call
    await setDoc(docRef, {
      listingId,
      title,
      description,
      category,
      condition,
      imageURL,
      startingPrice:     startPrice,
      currentBid:        null,
      currentBidderUid:  null,
      currentBidderName: null,
      sellerId:          user.uid,
      sellerName:        user.displayName || user.email,
      startTime:         now,
      endTime,
      status:            'active',
      bids:              []
    });

    showToast('Listing created!', 'success');
    window.location.href = `/listing.html?id=${listingId}`;
  } catch(err) {
    console.error(err);
    const msg = err?.code === 'storage/unauthorized'
      ? 'Image upload failed: check Firebase Storage rules (allow write if request.auth != null).'
      : 'Failed to create listing. Please try again.';
    showToast(msg, 'error');
    btn.disabled = false; btn.textContent = 'Create Listing';
    showLoading(false);
  }
}

async function uploadListingImage(file, listingId) {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, `images/${listingId}/${file.name}`);
    const task = uploadBytesResumable(storageRef, file);

    const progress = document.getElementById('upload-progress');
    const bar      = document.getElementById('upload-progress-bar');
    if (progress) progress.style.display = 'block';

    task.on('state_changed',
      snap => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        if (bar) bar.style.width = pct + '%';
      },
      err => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}

// ═══════════════════════════════════════════════════════════════
//  PROFILE PAGE
// ═══════════════════════════════════════════════════════════════
export async function initProfilePage() {
  applyConfig();
  initAuth();
  checkKillSwitch();

  const uid = getQueryParam('uid');
  if (!uid) { window.location.href = '/'; return; }

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) { show404(); return; }
    const userData = snap.data();
    renderProfile(userData, uid);
    await loadProfileListings(uid);
  } catch(e) {
    console.error(e);
    showToast('Failed to load profile.', 'error');
  }
}

function renderProfile(userData, uid) {
  const user = getCurrentUser();
  const isOwn = user?.uid === uid;
  const initials = (userData.displayName || 'U')[0].toUpperCase();
  const joined = userData.createdAt?.toDate?.()?.toLocaleDateString() || 'Unknown';

  document.getElementById('profile-avatar').textContent = escapeHTML(initials);
  document.getElementById('profile-name').textContent   = userData.displayName || 'Unknown';
  document.getElementById('profile-school').textContent = userData.school || '';
  document.getElementById('profile-joined').textContent = `Member since ${joined}`;

  if (isOwn) {
    const editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) {
      editBtn.style.display = '';
      editBtn.addEventListener('click', () => showEditProfileModal(userData));
    }
  } else if (user) {
    // Show "Message User" button when viewing someone else's profile while logged in
    const msgBtn = document.getElementById('message-user-btn');
    if (msgBtn) {
      msgBtn.style.display = '';
      msgBtn.addEventListener('click', () =>
        window.__messageUser?.(uid, userData.displayName || 'User')
      );
    }
  }
}

async function loadProfileListings(uid) {
  // Fetch all of this user's listings in one go and categorise client-side by
  // actual endTime — not just by status — so auctions that have timed out but
  // whose status hasn't been written yet still appear in the right tabs.
  const sellerQ = query(collection(db, 'listings'), where('sellerId', '==', uid));
  const wonQ    = query(collection(db, 'listings'), where('currentBidderUid', '==', uid));

  const [sellerSnap, wonSnap] = await Promise.all([getDocs(sellerQ), getDocs(wonQ)]);

  const now         = Date.now();
  const sellerItems = sellerSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const activeItems = sellerItems.filter(l => l.status === 'active' && tsMs(l.endTime) > now);
  const pastItems   = sellerItems.filter(l => l.status === 'ended'  || tsMs(l.endTime) <= now);
  const wonItems    = wonSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(l => l.status === 'ended' || tsMs(l.endTime) <= now);

  const renderItems = (items, containerId) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!items.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>No listings here yet.</p></div>`;
      return;
    }
    el.innerHTML = `<div class="listings-grid">${items.map(renderListingCard).join('')}</div>`;
    startCountdowns();
  };

  renderItems(activeItems, 'active-listings-tab');
  renderItems(pastItems,   'past-listings-tab');
  renderItems(wonItems,    'won-listings-tab');

  document.getElementById('stat-active').textContent = activeItems.length;
  document.getElementById('stat-sold').textContent   = pastItems.length;
  document.getElementById('stat-won').textContent    = wonItems.length;
}

function showEditProfileModal(userData) {
  const user = getCurrentUser();
  if (!user) return;

  const existing = document.getElementById('edit-profile-modal');
  if (existing) { existing.classList.add('open'); return; }

  const modal = document.createElement('div');
  modal.id = 'edit-profile-modal';
  modal.className = 'modal-overlay open';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Edit Profile</h2>
        <button class="modal-close" onclick="document.getElementById('edit-profile-modal').classList.remove('open')">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Display Name</label>
          <input type="text" id="edit-name" class="form-control" value="${escapeHTML(userData.displayName || '')}" maxlength="60">
        </div>
        <div class="form-group">
          <label class="form-label">School</label>
          <input type="text" id="edit-school" class="form-control" value="${escapeHTML(userData.school || '')}" maxlength="100">
        </div>
        <div id="edit-error" class="form-error"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('edit-profile-modal').classList.remove('open')">Cancel</button>
        <button class="btn btn-primary" id="save-profile-btn">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const name   = sanitizeInput(document.getElementById('edit-name').value);
    const school = sanitizeInput(document.getElementById('edit-school').value);
    if (!name) { document.getElementById('edit-error').textContent = 'Name is required.'; document.getElementById('edit-error').className = 'form-error visible'; return; }
    const btn = document.getElementById('save-profile-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await updateDoc(doc(db, 'users', user.uid), { displayName: name, school });
      document.getElementById('profile-name').textContent   = name;
      document.getElementById('profile-school').textContent = school;
      document.getElementById('profile-avatar').textContent = name[0].toUpperCase();
      modal.classList.remove('open');
      showToast('Profile updated!', 'success');
    } catch(e) {
      showToast('Failed to update profile.', 'error');
      btn.disabled = false; btn.textContent = 'Save Changes';
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

function show404() {
  document.querySelector('main').innerHTML = `
    <div class="container error-state" style="padding:80px 20px;text-align:center">
      <h2>404</h2>
      <h3>Listing not found</h3>
      <p style="color:var(--text-secondary);margin:12px 0 24px">This listing may have been removed or the link is incorrect.</p>
      <a href="/" class="btn btn-primary">Browse Listings</a>
    </div>`;
}

// Tab switcher (used on profile + other pages)
export function initTabs(tabsSelector = '.tab-btn', panelsSelector = '.tab-panel') {
  const tabs   = document.querySelectorAll(tabsSelector);
  const panels = document.querySelectorAll(panelsSelector);
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      target?.classList.add('active');
    });
  });
}
