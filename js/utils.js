// js/utils.js — Shared helpers imported by every page module
import { SITE_CONFIG } from '/config.js';

// Apply CSS variables + text from config to the current page
export function applyConfig() {
  const root = document.documentElement;
  root.style.setProperty('--primary', SITE_CONFIG.primaryColor);
  root.style.setProperty('--accent',  SITE_CONFIG.accentColor);

  document.querySelectorAll('.site-name').forEach(el => {
    el.textContent = SITE_CONFIG.name;
  });
  document.querySelectorAll('.site-tagline').forEach(el => {
    el.textContent = SITE_CONFIG.tagline;
  });

  const titleEl = document.querySelector('title');
  if (titleEl && !titleEl.dataset.applied) {
    titleEl.textContent = `${titleEl.textContent} | ${SITE_CONFIG.name}`;
    titleEl.dataset.applied = '1';
  }
}

// Returns { text, urgent, warning, ended } for countdown displays
export function formatTimeRemaining(endTimeMs) {
  const now  = Date.now();
  const diff = endTimeMs - now;

  if (diff <= 0) return { text: 'Ended', urgent: false, warning: false, ended: true };

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);

  let text;
  if (days > 0)       text = `${days}d ${hours % 24}h`;
  else if (hours > 0) text = `${hours}h ${minutes % 60}m`;
  else if (minutes > 0) text = `${minutes}m ${seconds % 60}s`;
  else                text = `${seconds}s`;

  return {
    text:    `Ends in ${text}`,
    urgent:  diff < 5 * 60 * 1000,     // < 5 min
    warning: diff < 60 * 60 * 1000,    // < 1 hour
    ended:   false
  };
}

export function formatRelativeTime(timestampMs) {
  const diff = Date.now() - timestampMs;
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(timestampMs).toLocaleDateString();
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ'}</span>
    <span class="toast-message">${escapeHTML(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-visible'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 320);
  }, 4000);
}

export function showLoading(show) {
  let overlay = document.getElementById('loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner"></div>';
    document.body.appendChild(overlay);
  }
  overlay.style.display = show ? 'flex' : 'none';
}

export function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/[<>]/g, '').substring(0, 2000);
}

export function escapeHTML(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

export function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// Update a countdown element's text + urgency classes
export function tickCountdown(el, endTimeMs) {
  if (!el) return;
  const result = formatTimeRemaining(endTimeMs);
  el.textContent = result.text;
  el.classList.toggle('ended',   result.ended);
  el.classList.toggle('urgent',  result.urgent);
  el.classList.toggle('warning', result.warning && !result.urgent);
}
