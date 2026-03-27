// js/messages.js — In-site messaging with real-time Firestore onSnapshot
import { db } from '/firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js';
import {
  applyConfig, showToast, escapeHTML, sanitizeInput, formatRelativeTime
} from '/js/utils.js';
import { initAuth, getCurrentUser, checkKillSwitch, onAuthChange } from '/js/auth.js';

export function initMessagesPage() {
  applyConfig();
  initAuth();
  checkKillSwitch();

  onAuthChange((user) => {
    if (!user) {
      document.getElementById('messages-auth-prompt')?.style.removeProperty('display');
      document.getElementById('messages-layout')?.style.setProperty('display', 'none');
      return;
    }
    document.getElementById('messages-auth-prompt')?.style.setProperty('display', 'none');
    document.getElementById('messages-layout')?.style.removeProperty('display');
    loadConversations(user);
  });
}

let activeConvId = null;
let activeUnsub  = null;

function loadConversations(user) {
  const sidebar   = document.getElementById('conversations-list');
  const chatArea  = document.getElementById('chat-area');

  if (!sidebar) return;

  sidebar.innerHTML = '<div style="padding:20px;color:var(--text-secondary);font-size:0.88rem">Loading…</div>';

  const q = query(
    collection(db, 'messages'),
    where('participants', 'array-contains', user.uid)
  );

  onSnapshot(q, snap => {
    if (snap.empty) {
      sidebar.innerHTML = `
        <div class="empty-state" style="padding:40px 16px">
          <div class="empty-icon">💬</div>
          <p>No conversations yet.</p>
          <small>Messages appear here when you win or sell an item.</small>
        </div>`;
      return;
    }

    const convs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aLast = a.messages?.at?.(-1)?.timestamp;
        const bLast = b.messages?.at?.(-1)?.timestamp;
        return tsMs(bLast) - tsMs(aLast);
      });

    sidebar.innerHTML = convs.map(c => renderConvItem(c, user.uid)).join('');

    sidebar.querySelectorAll('.conversation-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        sidebar.querySelectorAll('.conversation-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        openConversation(convs[i], user);
      });
    });

    // Auto-open conversation from URL param
    const urlConvId = new URL(window.location.href).searchParams.get('conv');
    if (urlConvId) {
      const idx = convs.findIndex(c => c.id === urlConvId);
      if (idx >= 0) {
        sidebar.querySelectorAll('.conversation-item')[idx]?.click();
      }
    }
  });
}

function renderConvItem(conv, myUid) {
  const otherUid  = conv.participants.find(p => p !== myUid) || '';
  const otherName = conv.otherNames?.[otherUid] || 'User';
  const lastMsg   = conv.messages?.at?.(-1);
  const initials  = otherName[0]?.toUpperCase() || '?';
  const time      = lastMsg ? formatRelativeTime(tsMs(lastMsg.timestamp)) : '';

  return `
    <div class="conversation-item" data-id="${escapeHTML(conv.id)}">
      <div class="conversation-avatar">${escapeHTML(initials)}</div>
      <div class="conversation-info">
        <div class="conversation-name">${escapeHTML(otherName)}</div>
        <div class="conversation-listing">📦 ${escapeHTML(conv.listingTitle || 'Item')}</div>
        ${lastMsg ? `<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(lastMsg.text || '')}</div>` : ''}
      </div>
      <div style="font-size:0.72rem;color:var(--text-secondary);flex-shrink:0;margin-left:auto">${escapeHTML(time)}</div>
    </div>`;
}

function openConversation(conv, user) {
  if (activeUnsub) { activeUnsub(); activeUnsub = null; }
  activeConvId = conv.id;

  const chatArea = document.getElementById('chat-area');
  if (!chatArea) return;

  const otherUid  = conv.participants.find(p => p !== user.uid) || '';
  const otherName = conv.otherNames?.[otherUid] || 'User';

  chatArea.innerHTML = `
    <div class="chat-header">
      <strong>${escapeHTML(otherName)}</strong>
      <div style="font-size:0.82rem;color:var(--text-secondary)">Re: ${escapeHTML(conv.listingTitle || '')}</div>
    </div>
    <div class="chat-messages" id="chat-messages-list"></div>
    <div class="chat-input-area">
      <textarea id="chat-msg-input" placeholder="Type a message…" rows="1"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();document.getElementById('chat-send-btn').click()}"
      ></textarea>
      <button class="btn btn-primary" id="chat-send-btn">Send</button>
    </div>
  `;

  // Real-time messages
  const convRef = doc(db, 'messages', conv.id);
  activeUnsub = onSnapshot(convRef, snap => {
    if (!snap.exists()) return;
    renderMessages(snap.data().messages || [], user.uid);
  });

  document.getElementById('chat-send-btn')?.addEventListener('click', () => {
    sendMessage(conv.id, user, document.getElementById('chat-msg-input'));
  });
}

function renderMessages(messages, myUid) {
  const list = document.getElementById('chat-messages-list');
  if (!list) return;

  if (!messages.length) {
    list.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
    return;
  }

  list.innerHTML = messages
    .sort((a,b) => tsMs(a.timestamp) - tsMs(b.timestamp))
    .map(m => {
      const isMe = m.senderUid === myUid;
      const time = formatRelativeTime(tsMs(m.timestamp));
      return `
        <div class="chat-bubble ${isMe ? 'chat-bubble-out' : 'chat-bubble-in'}">
          ${!isMe ? `<div style="font-size:0.78rem;font-weight:700;margin-bottom:4px;opacity:0.8">${escapeHTML(m.senderName || '')}</div>` : ''}
          ${escapeHTML(m.text)}
          <div class="chat-bubble-meta">${escapeHTML(time)}</div>
        </div>`;
    }).join('');

  list.scrollTop = list.scrollHeight;
}

async function sendMessage(convId, user, textarea) {
  if (!textarea) return;
  const text = sanitizeInput(textarea.value);
  if (!text) return;

  textarea.value = '';
  textarea.disabled = true;

  try {
    const msgEntry = {
      senderUid:  user.uid,
      senderName: user.displayName || user.email,
      text,
      timestamp:  Timestamp.now()
    };
    await updateDoc(doc(db, 'messages', convId), {
      messages: arrayUnion(msgEntry)
    });
  } catch(e) {
    console.error(e);
    showToast('Failed to send message.', 'error');
  } finally {
    textarea.disabled = false;
    textarea.focus();
  }
}

// Opens an existing direct conversation with targetUid, or creates one if none exists.
// Call this from any page where you want a "Message User" button.
export async function openOrCreateDirectConversation(targetUid, targetName, currentUser) {
  if (!currentUser) { window.__authModal?.('login'); return; }
  if (targetUid === currentUser.uid) { showToast("You can't message yourself.", 'error'); return; }

  try {
    // Look for an existing direct (non-auction) conversation between these two users
    const q = query(
      collection(db, 'messages'),
      where('participants', 'array-contains', currentUser.uid),
      where('listingId', '==', null)
    );
    const snap = await getDocs(q);
    const existing = snap.docs.find(d => d.data().participants.includes(targetUid));

    if (existing) {
      window.location.href = `/messages.html?conv=${existing.id}`;
      return;
    }

    // Create a fresh direct conversation
    const myName = currentUser.displayName || currentUser.email;
    const docRef = await addDoc(collection(db, 'messages'), {
      participants:  [currentUser.uid, targetUid],
      listingId:     null,
      listingTitle:  'Direct Message',
      otherNames: {
        [currentUser.uid]: myName,
        [targetUid]:       targetName
      },
      messages:  [],
      createdAt: serverTimestamp()
    });
    window.location.href = `/messages.html?conv=${docRef.id}`;
  } catch(e) {
    console.error(e);
    showToast('Could not open conversation.', 'error');
  }
}

// Called after auction expiry — creates a message thread between winner and seller
export async function createAuctionMessageThread(listing) {
  if (!listing.currentBidderUid || !listing.sellerId) return;
  if (listing.currentBidderUid === listing.sellerId) return;

  try {
    // Check if thread already exists
    const existing = await getDocs(query(
      collection(db, 'messages'),
      where('listingId', '==', listing.listingId)
    ));
    if (!existing.empty) return;

    await addDoc(collection(db, 'messages'), {
      participants: [listing.sellerId, listing.currentBidderUid],
      listingId:    listing.listingId || listing.id,
      listingTitle: listing.title,
      otherNames: {
        [listing.sellerId]:         listing.sellerName || 'Seller',
        [listing.currentBidderUid]: listing.currentBidderName || 'Buyer'
      },
      messages: [{
        senderUid:  'system',
        senderName: 'HMSBay',
        text:       `🏆 Congratulations! ${listing.currentBidderName || 'Buyer'} won "${listing.title}" with a bid of $${listing.currentBid?.toFixed(2)}. Use this chat to arrange collection.`,
        timestamp:  Timestamp.now()
      }],
      createdAt: serverTimestamp()
    });
  } catch(e) {
    console.error('Failed to create message thread:', e);
  }
}

function tsMs(ts) {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return Number(ts);
}
