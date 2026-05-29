'use strict';

const API = 'http://localhost:3000';
const FLASK = 'http://localhost:5000';
const GENRE_EMOJIS = ['🎬','🎭','🎥','🍿','🎞️','🌟','🏆','🎪'];

// ── Auth state ──────────────────────────────────────────────
let token = localStorage.getItem('seive_token') || null;
let currentUser = JSON.parse(localStorage.getItem('seive_user') || 'null');
let sseSource = null;
let unreadCount = 0;

const state = {
  watchlist: JSON.parse(localStorage.getItem('seive_watchlist') || '[]'),
  currentRecs: [],
  allUserIds: [],
};

// ── DOM refs ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dom = {
  authOverlay:   $('auth-overlay'),
  authTabLogin:  $('auth-tab-login'),
  authTabReg:    $('auth-tab-register'),
  loginForm:     $('login-form'),
  registerForm:  $('register-form'),
  loginEmail:    $('login-email'),
  loginPassword: $('login-password'),
  loginError:    $('login-error'),
  regUsername:   $('reg-username'),
  regEmail:      $('reg-email'),
  regPassword:   $('reg-password'),
  registerError: $('register-error'),
  toastContainer:$('toast-container'),
  notifBadge:    $('notif-badge'),
  notifBtn:      $('notif-btn'),
  tabKnown:      $('tab-known'),
  tabNew:        $('tab-new'),
  panelKnown:    $('panel-known'),
  panelNew:      $('panel-new'),
  panelMyrecs:   $('panel-myrecs'),
  myrecsBtn:     $('myrecs-btn'),
  userIdInput:   $('user-id-input'),
  recommendBtn:  $('recommend-btn'),
  showUsersBtn:  $('show-users-btn'),
  coldForm:      $('cold-start-form'),
  addRowBtn:     $('add-row-btn'),
  coldRecBtn:    $('cold-recommend-btn'),
  loader:        $('loader'),
  errorBanner:   $('error-banner'),
  errorText:     $('error-text'),
  feedSection:   $('feed-section'),
  feedTitle:     $('feed-title'),
  feedCount:     $('feed-count'),
  cardsGrid:     $('cards-grid'),
  usersModal:    $('users-modal'),
  closeModalBtn: $('close-modal-btn'),
  usersGrid:     $('users-grid'),
  drawerOverlay: $('drawer-overlay'),
  drawerClose:   $('drawer-close'),
  drawerContent: $('drawer-content'),
  navHome:       $('nav-home'),
  navMovies:     $('nav-movies'),
  navProfile:    $('nav-profile'),
};

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
function showAuthModal() { dom.authOverlay.classList.remove('hidden'); }
function hideAuthModal() { dom.authOverlay.classList.add('hidden'); }

function setAuth(user, tok) {
  currentUser = user; token = tok;
  localStorage.setItem('seive_token', tok);
  localStorage.setItem('seive_user', JSON.stringify(user));
  hideAuthModal();
  onLoggedIn();
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('seive_token');
  localStorage.removeItem('seive_user');
  if (sseSource) { sseSource.close(); sseSource = null; }
  dom.panelMyrecs.style.display = 'none';
  showAuthModal();
}

function onLoggedIn() {
  dom.panelMyrecs.style.display = '';
  showToast(`Welcome back, ${currentUser.username}! 🎬`);
  startSSE();
  loadUnreadCount();
}

// Auth tabs
dom.authTabLogin.addEventListener('click', () => {
  dom.authTabLogin.classList.add('active');
  dom.authTabReg.classList.remove('active');
  dom.loginForm.classList.remove('hidden');
  dom.registerForm.classList.add('hidden');
});
dom.authTabReg.addEventListener('click', () => {
  dom.authTabReg.classList.add('active');
  dom.authTabLogin.classList.remove('active');
  dom.registerForm.classList.remove('hidden');
  dom.loginForm.classList.add('hidden');
});

// Login
dom.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  dom.loginError.classList.add('hidden');
  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: dom.loginEmail.value, password: dom.loginPassword.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setAuth(data.user, data.token);
  } catch (err) {
    dom.loginError.textContent = err.message;
    dom.loginError.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

// Register
dom.registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  dom.registerError.classList.add('hidden');
  const btn = $('register-btn');
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: dom.regUsername.value,
        email: dom.regEmail.value,
        password: dom.regPassword.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    setAuth(data.user, data.token);
  } catch (err) {
    dom.registerError.textContent = err.message;
    dom.registerError.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});

// Profile nav → logout
dom.navProfile.addEventListener('click', () => {
  if (currentUser) {
    if (confirm(`Signed in as ${currentUser.username}. Sign out?`)) logout();
  } else {
    showAuthModal();
  }
});

// ═══════════════════════════════════════════════════════════
// SSE — real-time notifications
// ═══════════════════════════════════════════════════════════
function startSSE() {
  if (!token) return;
  if (sseSource) sseSource.close();
  sseSource = new EventSource(`${API}/api/notifications/stream?token=${token}`);
  sseSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      unreadCount++;
      updateBadge();
      showToast(data.message, 'success');
    } catch {}
  };
  sseSource.onerror = () => {
    sseSource.close();
    sseSource = null;
    setTimeout(startSSE, 5000);
  };
}

async function loadUnreadCount() {
  if (!token) return;
  try {
    const res = await fetch(`${API}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      unreadCount = data.unread || 0;
      updateBadge();
    }
  } catch {}
}

function updateBadge() {
  if (unreadCount > 0) {
    dom.notifBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
    dom.notifBadge.classList.remove('hidden');
  } else {
    dom.notifBadge.classList.add('hidden');
  }
}

dom.notifBtn.addEventListener('click', async () => {
  if (!token) return;
  unreadCount = 0; updateBadge();
  try {
    await fetch(`${API}/api/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
});

// ═══════════════════════════════════════════════════════════
// TOASTS
// ═══════════════════════════════════════════════════════════
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  dom.toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 4000);
}

// ═══════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════
async function apiFetch(url, opts = {}) {
  if (token) opts.headers = { ...opts.headers, Authorization: `Bearer ${token}` };
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  ['known','new'].forEach(t => {
    $(`tab-${t}`).classList.toggle('active', t === tab);
    $(`panel-${t}`).classList.toggle('active', t === tab);
  });
  hideError();
}
dom.tabKnown.addEventListener('click', () => switchTab('known'));
dom.tabNew.addEventListener('click',   () => switchTab('new'));

// ═══════════════════════════════════════════════════════════
// COLD-START FORM
// ═══════════════════════════════════════════════════════════
function createColdStartRow() {
  const row = document.createElement('div');
  row.className = 'cold-start-row';
  row.innerHTML = `
    <input type="text"   class="cs-movie-input"  placeholder="Movie title (e.g. Toy Story (1995))" />
    <input type="number" class="cs-rating-input" placeholder="Rating (1-5)" min="1" max="5" step="0.5" />
    <button class="remove-row-btn" aria-label="Remove">✕</button>
  `;
  row.querySelector('.remove-row-btn').addEventListener('click', () => {
    if (dom.coldForm.querySelectorAll('.cold-start-row').length > 1) row.remove();
  });
  return row;
}
dom.coldForm.querySelector('.remove-row-btn').addEventListener('click', () => {
  if (dom.coldForm.querySelectorAll('.cold-start-row').length > 1)
    dom.coldForm.querySelectorAll('.cold-start-row')[0].remove();
});
dom.addRowBtn.addEventListener('click', () => dom.coldForm.appendChild(createColdStartRow()));

// ═══════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════
const showLoader = () => dom.loader.classList.remove('hidden');
const hideLoader = () => dom.loader.classList.add('hidden');
const hideError  = () => dom.errorBanner.classList.add('hidden');

function showError(msg) {
  dom.errorText.textContent = msg;
  dom.errorBanner.classList.remove('hidden');
  dom.feedSection.classList.add('hidden');
}

const parseYear   = t => { const m = t.match(/\((\d{4})\)/); return m ? m[1] : '—'; };
const cleanTitle  = t => t.replace(/\s*\(\d{4}\)\s*$/, '').trim();
const randomEmoji = t => GENRE_EMOJIS[t.charCodeAt(0) % GENRE_EMOJIS.length];
const formatScore = s => (s * 10).toFixed(1);

function isWatchlisted(id) { return state.watchlist.includes(id); }
function toggleWatchlistLocal(id) {
  if (isWatchlisted(id)) state.watchlist = state.watchlist.filter(x => x !== id);
  else state.watchlist.push(id);
  localStorage.setItem('seive_watchlist', JSON.stringify(state.watchlist));
}

// ═══════════════════════════════════════════════════════════
// RENDER CARDS
// ═══════════════════════════════════════════════════════════
function renderCards(recs, label) {
  dom.cardsGrid.innerHTML = '';
  if (!recs.length) { showError('No recommendations found.'); return; }
  dom.feedSection.classList.remove('hidden');
  dom.feedTitle.textContent = label;
  dom.feedCount.textContent = `${recs.length} picks`;
  state.currentRecs = recs;
  recs.forEach((rec, i) => {
    const card = buildCard(rec, i);
    dom.cardsGrid.appendChild(card);
    card.style.animationDelay = `${i * 60}ms`;
  });
}

function buildCard(rec, rank) {
  const title  = rec.title;
  const score  = rec.predicted_rating;
  const year   = rec.release_year || parseYear(title);
  const clean  = cleanTitle(title);
  const emoji  = randomEmoji(title);
  const poster = rec.poster_url;
  const listed = isWatchlisted(rec.tmdb_id || title);
  const stars  = Math.max(1, Math.min(5, Math.round((score / 5) * 5)));

  const card = document.createElement('div');
  card.className = 'movie-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  card.innerHTML = `
    <div class="card-banner">
      ${poster
        ? `<img class="card-poster" src="${poster}" alt="${clean}" loading="lazy" />`
        : `<div class="card-banner-fallback">${emoji}</div>`}
      <span class="card-rank">#${rank + 1}</span>
      <span class="card-rating-badge"><span class="star-icon">★</span>${formatScore(score)}</span>
    </div>
    <div class="card-body">
      <div class="star-row">${Array.from({length:5},(_,s)=>`<span class="star${s<stars?' filled':''}" >★</span>`).join('')}</div>
      <h3 class="card-title">${clean}</h3>
      <div class="card-meta">
        <span class="meta-tag">${year}</span>
        <span class="meta-dot"></span>
        <span class="meta-tag">${rec.tmdb_rating ? `⭐ ${rec.tmdb_rating}` : 'AI Rec'}</span>
      </div>
      ${rec.genres && rec.genres.length ? `<div class="card-genres">${rec.genres.slice(0,3).map(g=>`<span class="genre-chip">${g}</span>`).join('')}</div>` : ''}
      <div class="card-footer">
        <span class="details-link">View details <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></span>
        <button class="add-watchlist-btn${listed?' added':''}" data-id="${rec.tmdb_id || ''}" data-title="${encodeURIComponent(title)}" aria-label="Watchlist">
          ${listed ? '✓ Saved' : '+ Watchlist'}
        </button>
      </div>
      ${token ? `<div class="rate-bar" data-movie-id="${rec.tmdb_id || ''}">
        <span class="rate-label">Rate:</span>
        ${[1,2,3,4,5].map(n=>`<button class="rate-star" data-val="${n}">★</button>`).join('')}
      </div>` : ''}
    </div>
  `;

  // Watchlist toggle
  card.querySelector('.add-watchlist-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const id  = btn.dataset.id;
    const t   = decodeURIComponent(btn.dataset.title);
    const key = id || t;
    const nowListed = !isWatchlisted(key);
    toggleWatchlistLocal(key);
    btn.classList.toggle('added', nowListed);
    btn.textContent = nowListed ? '✓ Saved' : '+ Watchlist';
    if (token && id) {
      try {
        if (nowListed) await apiFetch(`${API}/api/watchlist`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({movie_id: parseInt(id)}) });
        else           await apiFetch(`${API}/api/watchlist/${id}`, { method:'DELETE' });
      } catch {}
    }
  });

  // Rate stars
  const rateBar = card.querySelector('.rate-bar');
  if (rateBar) {
    const movieId = parseInt(rateBar.dataset.movieId);
    rateBar.querySelectorAll('.rate-star').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!token) { showAuthModal(); return; }
        if (!movieId) { showToast('Movie not in DB yet — rate after seeding.', 'info'); return; }
        const val = parseInt(btn.dataset.val);
        rateBar.querySelectorAll('.rate-star').forEach((s,i) => s.classList.toggle('active', i < val));
        try {
          await apiFetch(`${API}/api/ratings`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ movie_id: movieId, rating: val }),
          });
          showToast(`Rated "${cleanTitle(title)}" ${val}★ — recommendations updating…`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  card.addEventListener('click', () => openDrawer(rec, rank));
  card.addEventListener('keydown', e => { if (e.key === 'Enter') openDrawer(rec, rank); });
  return card;
}

// ═══════════════════════════════════════════════════════════
// KNOWN USER RECS (Flask direct)
// ═══════════════════════════════════════════════════════════
async function fetchKnownUserRecs(userId) {
  showLoader(); hideError(); dom.feedSection.classList.add('hidden');
  try {
    const data = await apiFetch(`${FLASK}/api/recommend/${userId}?top_n=20`);
    renderCards(data.recommendations, `Picks for User ${userId}`);
  } catch (err) { showError(err.message); }
  finally { hideLoader(); }
}

dom.recommendBtn.addEventListener('click', () => {
  const uid = parseInt(dom.userIdInput.value, 10);
  if (!uid || uid < 1 || uid > 610) { showError('Enter a valid User ID (1–610).'); return; }
  fetchKnownUserRecs(uid);
});
dom.userIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') dom.recommendBtn.click(); });

// ═══════════════════════════════════════════════════════════
// COLD-START (Flask direct)
// ═══════════════════════════════════════════════════════════
dom.coldRecBtn.addEventListener('click', async () => {
  const ratings = {};
  dom.coldForm.querySelectorAll('.cold-start-row').forEach(row => {
    const movie  = row.querySelector('.cs-movie-input').value.trim();
    const rating = parseFloat(row.querySelector('.cs-rating-input').value);
    if (movie && !isNaN(rating)) ratings[movie] = rating;
  });
  if (!Object.keys(ratings).length) { showError('Enter at least one movie and rating.'); return; }
  showLoader(); hideError(); dom.feedSection.classList.add('hidden');
  try {
    const data = await apiFetch(`${FLASK}/api/recommend/new-user`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ ratings, top_n: 20 }),
    });
    renderCards(data.recommendations, 'Your Personalised Picks');
  } catch (err) { showError(err.message); }
  finally { hideLoader(); }
});

// ═══════════════════════════════════════════════════════════
// MY RECOMMENDATIONS (Express — cached)
// ═══════════════════════════════════════════════════════════
dom.myrecsBtn && dom.myrecsBtn.addEventListener('click', async () => {
  if (!token) { showAuthModal(); return; }
  showLoader(); hideError(); dom.feedSection.classList.add('hidden');
  try {
    const data = await apiFetch(`${API}/api/recommendations`);
    if (!data.recommendations.length) { showError('No recommendations yet. Rate some movies first!'); return; }
    renderCards(data.recommendations, 'My Recommendations');
  } catch (err) { showError(err.message); }
  finally { hideLoader(); }
});

// ═══════════════════════════════════════════════════════════
// USERS MODAL
// ═══════════════════════════════════════════════════════════
async function openUsersModal() {
  dom.usersModal.classList.remove('hidden');
  if (!state.allUserIds.length) {
    dom.usersGrid.innerHTML = '<p style="color:var(--gray-2);font-size:.85rem">Loading…</p>';
    try {
      const data = await apiFetch(`${FLASK}/api/users`);
      state.allUserIds = data.user_ids;
    } catch { dom.usersGrid.innerHTML = '<p style="color:var(--danger)">Failed to load users.</p>'; return; }
  }
  dom.usersGrid.innerHTML = '';
  state.allUserIds.forEach(uid => {
    const chip = document.createElement('button');
    chip.className = 'user-chip'; chip.textContent = uid;
    chip.addEventListener('click', () => {
      dom.userIdInput.value = uid;
      dom.usersModal.classList.add('hidden');
      switchTab('known');
      fetchKnownUserRecs(uid);
    });
    dom.usersGrid.appendChild(chip);
  });
}
dom.showUsersBtn.addEventListener('click', openUsersModal);
dom.closeModalBtn.addEventListener('click', () => dom.usersModal.classList.add('hidden'));
dom.usersModal.addEventListener('click', e => { if (e.target === dom.usersModal) dom.usersModal.classList.add('hidden'); });

// ═══════════════════════════════════════════════════════════
// DRAWER
// ═══════════════════════════════════════════════════════════
const SYNOPSES = [
  "A captivating story that keeps you on the edge of your seat.",
  "Brilliant performances elevate this into an unforgettable experience.",
  "A masterclass in storytelling with stunning visuals.",
  "An emotional rollercoaster that resonates long after the credits.",
  "Expertly crafted with sharp wit and remarkable depth.",
];

function openDrawer(rec, rank) {
  const title = rec.title;
  const score = rec.predicted_rating;
  const year  = rec.release_year || parseYear(title);
  const clean = cleanTitle(title);
  const stars = Math.max(1, Math.min(5, Math.round((score/5)*5)));
  const emoji = randomEmoji(title);

  dom.drawerContent.innerHTML = `
    ${rec.poster_url
      ? `<img class="drawer-poster" src="${rec.poster_url}" alt="${clean}" />`
      : `<div class="drawer-hero-fallback">${emoji}</div>`}
    <h2 class="drawer-title">${clean}</h2>
    <div class="drawer-meta">
      <span class="meta-tag">${year}</span>
      <span class="meta-tag">Rank #${rank+1}</span>
      ${rec.tmdb_rating ? `<span class="meta-tag">⭐ ${rec.tmdb_rating}</span>` : ''}
    </div>
    <div class="drawer-stars">${Array.from({length:5},(_,s)=>`<span class="drawer-star${s<stars?' filled':''}">★</span>`).join('')}</div>
    ${rec.genres && rec.genres.length ? `<div class="drawer-genres">${rec.genres.map(g=>`<span class="genre-chip">${g}</span>`).join('')}</div>` : ''}
    <div class="drawer-stats">
      <div class="drawer-stat"><span class="drawer-stat-value">${formatScore(score)}</span><span class="drawer-stat-label">Match Score</span></div>
      <div class="drawer-stat"><span class="drawer-stat-value">${year}</span><span class="drawer-stat-label">Year</span></div>
      <div class="drawer-stat"><span class="drawer-stat-value">#${rank+1}</span><span class="drawer-stat-label">Your Rank</span></div>
    </div>
    <p class="drawer-section-title">About this film</p>
    <p class="drawer-synopsis">${rec.overview || SYNOPSES[title.charCodeAt(1) % SYNOPSES.length]}</p>
    <button class="drawer-recommend-btn" id="drawer-wl-btn">+ Add to Watchlist</button>
  `;

  $('drawer-wl-btn').addEventListener('click', async () => {
    const id  = rec.tmdb_id;
    const key = id || title;
    toggleWatchlistLocal(key);
    $('drawer-wl-btn').textContent = isWatchlisted(key) ? '✓ Saved to Watchlist' : '+ Add to Watchlist';
    if (token && id) {
      try { await apiFetch(`${API}/api/watchlist`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({movie_id: id}) }); } catch {}
    }
  });

  dom.drawerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() { dom.drawerOverlay.classList.add('hidden'); document.body.style.overflow = ''; }
dom.drawerClose.addEventListener('click', closeDrawer);
dom.drawerOverlay.addEventListener('click', e => { if (e.target === dom.drawerOverlay) closeDrawer(); });

// ═══════════════════════════════════════════════════════════
// BOTTOM NAV
// ═══════════════════════════════════════════════════════════
function setActiveNav(el) { document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); el.classList.add('active'); }

dom.navMovies.addEventListener('click', async () => {
  setActiveNav(dom.navMovies); showLoader(); hideError(); dom.feedSection.classList.add('hidden');
  try {
    const data = await apiFetch(`${FLASK}/api/movies?per_page=50`);
    renderCards(data.movies.map(t => ({ title: t, predicted_rating: +(Math.random()*2+3).toFixed(2) })), 'Browse Movies');
  } catch { showError('Could not load movies.'); }
  finally { hideLoader(); }
});

dom.navHome.addEventListener('click', () => {
  setActiveNav(dom.navHome);
  dom.feedSection.classList.add('hidden');
  dom.errorBanner.classList.add('hidden');
  window.scrollTo({ top:0, behavior:'smooth' });
});

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
(async () => {
  if (token && currentUser) {
    onLoggedIn();
  } else {
    showAuthModal();
  }
})();
