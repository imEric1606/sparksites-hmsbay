// js/auth.js — Firebase Auth state, login/register modal, nav rendering
import { auth, db } from '/firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js';
import {
  doc, setDoc, getDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import { showToast, escapeHTML, sanitizeInput } from '/js/utils.js';

let currentUser = null;
let currentUserDoc = null;
const authListeners = [];

// ── Public state ──────────────────────────────────────────────
export function getCurrentUser()    { return currentUser; }
export function getCurrentUserDoc() { return currentUserDoc; }

export function onAuthChange(cb) { authListeners.push(cb); }

// ── Init: listen for auth state + build nav ──────────────────
export function initAuth(opts = {}) {
  renderNavAuth(null);

  onAuthStateChanged(auth, async user => {
    currentUser = user;
    currentUserDoc = null;

    if (user) {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        currentUserDoc = snap.exists() ? snap.data() : null;

        if (currentUserDoc?.isBanned) {
          await signOut(auth);
          showToast('Your account has been banned. Contact admin.', 'error');
          return;
        }
      } catch (e) {
        console.warn('Could not fetch user doc:', e);
      }
    }

    renderNavAuth(user);
    authListeners.forEach(cb => cb(user, currentUserDoc));

    if (opts.requireAuth && !user) {
      openAuthModal('login');
    }
  });

  injectAuthModal();
  injectMaintenanceOverlay();
}

// ── Nav auth area ─────────────────────────────────────────────
function renderNavAuth(user) {
  const area = document.getElementById('nav-auth');
  if (!area) return;

  if (!user) {
    area.innerHTML = `
      <button class="btn-nav-login"   onclick="window.__authModal('login')">Log In</button>
      <button class="btn-nav-register" onclick="window.__authModal('register')">Register</button>
    `;
  } else {
    const initials = (user.displayName || user.email || '?')[0].toUpperCase();
    area.innerHTML = `
      <div class="user-menu">
        <button class="user-avatar-btn" id="nav-avatar-btn" title="${escapeHTML(user.displayName || user.email)}">
          ${escapeHTML(initials)}
        </button>
        <div class="user-dropdown" id="user-dropdown">
          <div class="user-dropdown-header">
            <strong>${escapeHTML(user.displayName || 'User')}</strong>
            <small>${escapeHTML(user.email)}</small>
          </div>
          <a href="/profile.html?uid=${user.uid}">👤 My Profile</a>
          <a href="/create-listing.html">＋ Sell an Item</a>
          <a href="/messages.html">💬 Messages</a>
          <button class="logout-btn" onclick="window.__logout()">⬡ Log Out</button>
        </div>
      </div>
    `;
    document.getElementById('nav-avatar-btn')?.addEventListener('click', () => {
      document.getElementById('user-dropdown')?.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.user-menu')) {
        document.getElementById('user-dropdown')?.classList.remove('open');
      }
    }, { capture: true });
  }
}

// ── Auth Modal ────────────────────────────────────────────────
function injectAuthModal() {
  const modal = document.createElement('div');
  modal.id = 'auth-modal-overlay';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2 id="auth-modal-title">Log In</h2>
        <button class="modal-close" onclick="window.__authModal(null)">✕</button>
      </div>
      <div class="modal-body">
        <div class="modal-tab-bar">
          <button class="modal-tab active" id="tab-login"    onclick="window.__authModal('login')">Log In</button>
          <button class="modal-tab"        id="tab-register" onclick="window.__authModal('register')">Register</button>
        </div>

        <!-- Login form -->
        <form id="form-login" novalidate>
          <div class="form-group">
            <label class="form-label">Email <span class="req">*</span></label>
            <input type="email" id="login-email" class="form-control" placeholder="you@school.edu" autocomplete="email" required>
          </div>
          <div class="form-group">
            <label class="form-label">Password <span class="req">*</span></label>
            <input type="password" id="login-password" class="form-control" placeholder="••••••••" autocomplete="current-password" required>
          </div>
          <div id="login-error" class="form-error"></div>
          <button type="submit" class="btn btn-primary btn-block" id="login-submit">Log In</button>
        </form>

        <!-- Register form -->
        <form id="form-register" novalidate style="display:none">
          <div class="form-group">
            <label class="form-label">Display Name <span class="req">*</span></label>
            <input type="text" id="reg-name" class="form-control" placeholder="Your name" maxlength="60" required>
          </div>
          <div class="form-group">
            <label class="form-label">Email <span class="req">*</span></label>
            <input type="email" id="reg-email" class="form-control" placeholder="you@school.edu" autocomplete="email" required>
          </div>
          <div class="form-group">
            <label class="form-label">Password <span class="req">*</span></label>
            <input type="password" id="reg-password" class="form-control" placeholder="Min 6 characters" autocomplete="new-password" required minlength="6">
          </div>
          <div class="form-group">
            <label class="form-label">Confirm Password <span class="req">*</span></label>
            <input type="password" id="reg-confirm" class="form-control" placeholder="Repeat password" required>
          </div>
          <div class="form-group">
            <label class="form-label">School</label>
            <input type="text" id="reg-school" class="form-control" placeholder="Your school name" maxlength="100">
          </div>
          <div id="reg-error" class="form-error"></div>
          <button type="submit" class="btn btn-primary btn-block" id="reg-submit">Create Account</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', e => { if (e.target === modal) window.__authModal(null); });

  document.getElementById('form-login').addEventListener('submit', handleLogin);
  document.getElementById('form-register').addEventListener('submit', handleRegister);
}

// Expose globally for inline onclick usage
window.__authModal = function(tab) {
  const overlay  = document.getElementById('auth-modal-overlay');
  const title    = document.getElementById('auth-modal-title');
  const fLogin   = document.getElementById('form-login');
  const fReg     = document.getElementById('form-register');
  const tabLogin = document.getElementById('tab-login');
  const tabReg   = document.getElementById('tab-register');

  if (!overlay) return;
  if (tab === null) {
    overlay.classList.remove('open');
    return;
  }
  overlay.classList.add('open');
  if (tab === 'login') {
    title.textContent = 'Log In';
    fLogin.style.display = ''; fReg.style.display = 'none';
    tabLogin.classList.add('active'); tabReg.classList.remove('active');
    document.getElementById('login-email')?.focus();
  } else {
    title.textContent = 'Create Account';
    fLogin.style.display = 'none'; fReg.style.display = '';
    tabLogin.classList.remove('active'); tabReg.classList.add('active');
    document.getElementById('reg-name')?.focus();
  }
};

window.__logout = async function() {
  try {
    await signOut(auth);
    showToast('Logged out.', 'info');
    window.location.href = '/';
  } catch(e) {
    showToast('Logout failed.', 'error');
  }
};

async function handleLogin(e) {
  e.preventDefault();
  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-password');
  const errEl   = document.getElementById('login-error');
  const btn     = document.getElementById('login-submit');
  errEl.textContent = ''; errEl.className = 'form-error';

  const email = sanitizeInput(emailEl.value);
  const pass  = passEl.value;
  if (!email || !pass) { showFieldError(errEl, 'Please fill in all fields.'); return; }

  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    window.__authModal(null);
    showToast('Welcome back!', 'success');
  } catch(err) {
    showFieldError(errEl, friendlyAuthError(err.code));
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name    = sanitizeInput(document.getElementById('reg-name').value);
  const email   = sanitizeInput(document.getElementById('reg-email').value);
  const pass    = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;
  const school  = sanitizeInput(document.getElementById('reg-school').value);
  const errEl   = document.getElementById('reg-error');
  const btn     = document.getElementById('reg-submit');
  errEl.textContent = ''; errEl.className = 'form-error';

  if (!name || !email || !pass || !confirm) { showFieldError(errEl, 'Please fill in all required fields.'); return; }
  if (pass.length < 6) { showFieldError(errEl, 'Password must be at least 6 characters.'); return; }
  if (pass !== confirm) { showFieldError(errEl, 'Passwords do not match.'); return; }

  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      displayName: name,
      email: email,
      school: school || '',
      createdAt: serverTimestamp(),
      isBanned: false,
      isAdmin: false,
      activeListings: [],
      pastListings: []
    });
    window.__authModal(null);
    showToast('Account created! Welcome to HMSBay.', 'success');
  } catch(err) {
    showFieldError(errEl, friendlyAuthError(err.code));
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

function showFieldError(el, msg) {
  el.textContent = msg;
  el.className = 'form-error visible';
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Invalid email or password.',
    'auth/email-already-in-use':   'An account with this email already exists.',
    'auth/weak-password':          'Password is too weak (min 6 chars).',
    'auth/invalid-email':          'Please enter a valid email address.',
    'auth/too-many-requests':      'Too many attempts. Please try again later.',
  };
  return map[code] || 'An error occurred. Please try again.';
}

// ── Kill-switch check ─────────────────────────────────────────
function injectMaintenanceOverlay() {
  if (document.getElementById('maintenance-overlay')) return;
  const el = document.createElement('div');
  el.id = 'maintenance-overlay';
  el.className = 'maintenance-overlay';
  el.innerHTML = `
    <h1>🔧 Site Maintenance</h1>
    <p id="maintenance-message">We'll be back soon. Check back later.</p>
  `;
  document.body.appendChild(el);
}

export async function checkKillSwitch() {
  // Skip kill-switch check on admin pages
  if (window.location.pathname.startsWith('/admin')) return;
  try {
    const { getDoc, doc: firestoreDoc } = await import('https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js');
    const snap = await getDoc(firestoreDoc(db, 'siteSettings', 'global'));
    if (snap.exists() && snap.data().killSwitchActive) {
      const msg = snap.data().maintenanceMessage || 'Site under maintenance.';
      const overlay = document.getElementById('maintenance-overlay');
      if (overlay) {
        overlay.querySelector('#maintenance-message').textContent = msg;
        overlay.classList.add('show');
      }
    }
  } catch(e) { /* fail silently */ }
}

// Require the user to be logged in; if not, show auth modal
export function requireAuth(cb) {
  onAuthStateChanged(auth, user => {
    if (!user) { openAuthModal('login'); }
    else if (cb) cb(user);
  });
}

function openAuthModal(tab) { window.__authModal?.(tab); }

export { auth };
