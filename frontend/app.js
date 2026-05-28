/* ═══════════════════════════════════════════════════════════
   SEIVE — MOVIE RECOMMENDER  |  app.js
   All API calls go to the Express API which proxies ML calls
   internally to Flask. The browser only needs one base URL.
═══════════════════════════════════════════════════════════ */

'use strict';

// ── Config ─────────────────────────────────────────────────
// When served via Docker/Nginx the browser hits the same host on port 8080;
// Nginx proxies /api/* to Express :3000.
// When running locally outside Docker, Express is on :3000 directly.
const API_BASE = '';

// Emoji fallbacks grouped by decade keywords for visual variety
const GENRE_EMOJIS = ['🎬', '🎭', '🎥', '🍿', '🎞️', '🌟', '🏆', '🎪'];

// ── State ──────────────────────────────────────────────────
const state = {
  watchlist: JSON.parse(localStorage.getItem('seive_watchlist') || '[]'),
  currentRecs: [],
  allUserIds: [],
};

// ── DOM refs ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const dom = {
  // Tabs
  tabKnown:      $('tab-known'),
  tabNew:        $('tab-new'),
  panelKnown:    $('panel-known'),
  panelNew:      $('panel-new'),
  // Known user
  userIdInput:   $('user-id-input'),
  recommendBtn:  $('recommend-btn'),
  showUsersBtn:  $('show-users-btn'),
  // Cold start
  coldForm:      $('cold-start-form'),
  addRowBtn:     $('add-row-btn'),
  coldRecBtn:    $('cold-recommend-btn'),
  // Output
  loader:        $('loader'),
  errorBanner:   $('error-banner'),
  errorText:     $('error-text'),
  feedSection:   $('feed-section'),
  feedTitle:     $('feed-title'),
  feedCount:     $('feed-count'),
  cardsGrid:     $('cards-grid'),
  // Modal
  usersModal:    $('users-modal'),
  closeModalBtn: $('close-modal-btn'),
  usersGrid:     $('users-grid'),
  // Drawer
  drawerOverlay: $('drawer-overlay'),
  drawerClose:   $('drawer-close'),
  drawerContent: $('drawer-content'),
  // Nav
  navHome:       $('nav-home'),
  navMovies:     $('nav-movies'),
};

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  const isKnown = tab === 'known';
  dom.tabKnown.classList.toggle('active', isKnown);
  dom.tabNew.classList.toggle('active', !isKnown);
  dom.panelKnown.classList.toggle('active', isKnown);
  dom.panelNew.classList.toggle('active', !isKnown);
  hideError();
}

dom.tabKnown.addEventListener('click', () => switchTab('known'));
dom.tabNew.addEventListener('click',   () => switchTab('new'));

// ═══════════════════════════════════════════════════════════
// COLD-START FORM — add/remove rows
// ═══════════════════════════════════════════════════════════
function createColdStartRow() {
  const row = document.createElement('div');
  row.className = 'cold-start-row';
  row.innerHTML = `
    <input type="text"   class="cs-movie-input"  placeholder="Movie title (e.g. Toy Story (1995))" />
    <input type="number" class="cs-rating-input" placeholder="Rating (1-5)" min="1" max="5" step="0.5" />
    <button class="remove-row-btn" aria-label="Remove row">✕</button>
  `;
  row.querySelector('.remove-row-btn').addEventListener('click', () => {
    if (dom.coldForm.querySelectorAll('.cold-start-row').length > 1) {
      row.remove();
    }
  });
  return row;
}

// Wire up the initial row's remove button
dom.coldForm.querySelector('.remove-row-btn').addEventListener('click', () => {
  const rows = dom.coldForm.querySelectorAll('.cold-start-row');
  if (rows.length > 1) rows[0].remove();
});

dom.addRowBtn.addEventListener('click', () => {
  dom.coldForm.appendChild(createColdStartRow());
});

// ═══════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════
async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════
function showLoader()  { dom.loader.classList.remove('hidden'); }
function hideLoader()  { dom.loader.classList.add('hidden'); }
function hideError()   { dom.errorBanner.classList.add('hidden'); }

function showError(msg) {
  dom.errorText.textContent = msg;
  dom.errorBanner.classList.remove('hidden');
  dom.feedSection.classList.add('hidden');
}

function parseYear(title) {
  const m = title.match(/\((\d{4})\)/);
  return m ? m[1] : '—';
}

function cleanTitle(title) {
  return title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
}

function ratingToStars(score) {
  // predicted_rating is an average of neighbour ratings (0-5 scale)
  const stars = Math.round((score / 5) * 5);
  return Math.max(1, Math.min(5, stars));
}

function randomEmoji(title) {
  const idx = title.charCodeAt(0) % GENRE_EMOJIS.length;
  return GENRE_EMOJIS[idx];
}

function formatScore(score) {
  return (score * 10).toFixed(1); // render as a /10 style score
}

function isWatchlisted(title) {
  return state.watchlist.includes(title);
}

function toggleWatchlist(title) {
  if (isWatchlisted(title)) {
    state.watchlist = state.watchlist.filter((t) => t !== title);
  } else {
    state.watchlist.push(title);
  }
  localStorage.setItem('seive_watchlist', JSON.stringify(state.watchlist));
}

// ═══════════════════════════════════════════════════════════
// RENDER CARDS
// ═══════════════════════════════════════════════════════════
function renderCards(recs, titleLabel) {
  dom.cardsGrid.innerHTML = '';

  if (!recs.length) {
    showError('No recommendations found. Try a different input.');
    return;
  }

  dom.feedSection.classList.remove('hidden');
  dom.feedTitle.textContent = titleLabel;
  dom.feedCount.textContent = `${recs.length} picks`;
  state.currentRecs = recs;

  recs.forEach((rec, i) => {
    const card = buildCard(rec, i);
    dom.cardsGrid.appendChild(card);
    // stagger animation
    card.style.animationDelay = `${i * 60}ms`;
  });
}

function buildCard(rec, rank) {
  const title  = rec.title;
  const score  = rec.predicted_rating;
  const year   = parseYear(title);
  const clean  = cleanTitle(title);
  const stars  = ratingToStars(score);
  const emoji  = randomEmoji(title);
  const listed = isWatchlisted(title);

  const card = document.createElement('div');
  card.className = 'movie-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${clean} — details`);

  card.innerHTML = `
    <div class="card-banner">
      <div class="card-banner-fallback">${emoji}</div>
      <span class="card-rank">#${rank + 1}</span>
      <span class="card-rating-badge">
        <span class="star-icon">★</span>${formatScore(score)}
      </span>
    </div>
    <div class="card-body">
      <div class="star-row">
        ${Array.from({ length: 5 }, (_, s) =>
          `<span class="star${s < stars ? ' filled' : ''}">★</span>`
        ).join('')}
      </div>
      <h3 class="card-title">${clean}</h3>
      <div class="card-meta">
        <span class="meta-tag">${year}</span>
        <span class="meta-dot"></span>
        <span class="meta-tag">AI Rec</span>
      </div>
      <div class="card-footer">
        <span class="details-link">
          View details
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </span>
        <button class="add-watchlist-btn${listed ? ' added' : ''}" data-title="${encodeURIComponent(title)}" aria-label="Add to watchlist">
          ${listed
            ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg> Saved`
            : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Watchlist`}
        </button>
      </div>
    </div>
  `;

  // Watchlist toggle
  card.querySelector('.add-watchlist-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const t   = decodeURIComponent(btn.dataset.title);
    toggleWatchlist(t);
    const nowListed = isWatchlisted(t);
    btn.classList.toggle('added', nowListed);
    btn.innerHTML = nowListed
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg> Saved`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Watchlist`;
  });

  // Open drawer on card click
  card.addEventListener('click', () => openDrawer(rec, rank));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDrawer(rec, rank); });

  return card;
}

// ═══════════════════════════════════════════════════════════
// KNOWN USER — RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════
async function fetchKnownUserRecs(userId) {
  showLoader();
  hideError();
  dom.feedSection.classList.add('hidden');

  try {
    const data = await apiFetch(`/api/ml/recommend/${userId}?top_n=20`);
    renderCards(data.recommendations, `Picks for User ${userId}`);
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoader();
  }
}

dom.recommendBtn.addEventListener('click', () => {
  const uid = parseInt(dom.userIdInput.value, 10);
  if (!uid || uid < 1 || uid > 610) {
    showError('Please enter a valid User ID between 1 and 610.');
    return;
  }
  fetchKnownUserRecs(uid);
});

dom.userIdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') dom.recommendBtn.click();
});

// ═══════════════════════════════════════════════════════════
// COLD-START — NEW USER RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════
dom.coldRecBtn.addEventListener('click', async () => {
  const rows   = dom.coldForm.querySelectorAll('.cold-start-row');
  const ratings = {};

  rows.forEach((row) => {
    const movie  = row.querySelector('.cs-movie-input').value.trim();
    const rating = parseFloat(row.querySelector('.cs-rating-input').value);
    if (movie && !isNaN(rating)) {
      ratings[movie] = rating;
    }
  });

  if (Object.keys(ratings).length === 0) {
    showError('Please enter at least one movie title and rating.');
    return;
  }

  showLoader();
  hideError();
  dom.feedSection.classList.add('hidden');

  try {
    const data = await apiPost('/api/ml/recommend/new-user', { ratings, top_n: 20 });
    renderCards(data.recommendations, 'Your Personalised Picks');
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoader();
  }
});

// ═══════════════════════════════════════════════════════════
// USERS MODAL
// ═══════════════════════════════════════════════════════════
async function openUsersModal() {
  dom.usersModal.classList.remove('hidden');

  if (state.allUserIds.length === 0) {
    dom.usersGrid.innerHTML = '<p style="color:var(--gray-2);font-size:.85rem">Loading…</p>';
    try {
      const data = await apiFetch('/api/ml/users');
      state.allUserIds = data.user_ids;
    } catch {
      dom.usersGrid.innerHTML = '<p style="color:var(--danger);font-size:.85rem">Failed to load users.</p>';
      return;
    }
  }

  dom.usersGrid.innerHTML = '';
  state.allUserIds.forEach((uid) => {
    const chip = document.createElement('button');
    chip.className = 'user-chip';
    chip.textContent = uid;
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
dom.usersModal.addEventListener('click', (e) => {
  if (e.target === dom.usersModal) dom.usersModal.classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════
// DETAIL DRAWER
// ═══════════════════════════════════════════════════════════
const SYNOPSES = [
  "A captivating story that keeps you on the edge of your seat from start to finish.",
  "Brilliant performances elevate this film into an unforgettable cinematic experience.",
  "A masterclass in storytelling with stunning visuals and a gripping narrative.",
  "An emotional rollercoaster that resonates long after the credits roll.",
  "Expertly crafted with sharp wit, powerful moments, and remarkable depth.",
];

function openDrawer(rec, rank) {
  const title  = rec.title;
  const score  = rec.predicted_rating;
  const year   = parseYear(title);
  const clean  = cleanTitle(title);
  const stars  = ratingToStars(score);
  const emoji  = randomEmoji(title);
  const synIdx = title.charCodeAt(1) % SYNOPSES.length;
  const listed = isWatchlisted(title);

  dom.drawerContent.innerHTML = `
    <div class="drawer-hero-fallback">${emoji}</div>

    <h2 class="drawer-title">${clean}</h2>

    <div class="drawer-meta">
      <span class="meta-tag">${year}</span>
      <span class="meta-tag">AI-Recommended</span>
      <span class="meta-tag">Rank #${rank + 1}</span>
    </div>

    <div class="drawer-stars">
      ${Array.from({ length: 5 }, (_, s) =>
        `<span class="drawer-star${s < stars ? ' filled' : ''}">★</span>`
      ).join('')}
    </div>

    <div class="drawer-stats">
      <div class="drawer-stat">
        <span class="drawer-stat-value">${formatScore(score)}</span>
        <span class="drawer-stat-label">Match Score</span>
      </div>
      <div class="drawer-stat">
        <span class="drawer-stat-value">${year}</span>
        <span class="drawer-stat-label">Year</span>
      </div>
      <div class="drawer-stat">
        <span class="drawer-stat-value">#${rank + 1}</span>
        <span class="drawer-stat-label">Your Rank</span>
      </div>
    </div>

    <p class="drawer-section-title">About this film</p>
    <p class="drawer-synopsis">${SYNOPSES[synIdx]}</p>

    <button class="drawer-recommend-btn" id="drawer-watchlist-btn">
      ${listed
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg> Saved to Watchlist`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Watchlist`}
    </button>
  `;

  const wlBtn = $('drawer-watchlist-btn');
  wlBtn.addEventListener('click', () => {
    toggleWatchlist(title);
    const nowListed = isWatchlisted(title);
    wlBtn.innerHTML = nowListed
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg> Saved to Watchlist`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Watchlist`;
    // Also refresh the card button in the grid
    const cardBtns = dom.cardsGrid.querySelectorAll('.add-watchlist-btn');
    cardBtns.forEach((btn) => {
      if (decodeURIComponent(btn.dataset.title) === title) {
        btn.classList.toggle('added', nowListed);
        btn.innerHTML = nowListed
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg> Saved`
          : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Watchlist`;
      }
    });
  });

  dom.drawerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  dom.drawerOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

dom.drawerClose.addEventListener('click', closeDrawer);
dom.drawerOverlay.addEventListener('click', (e) => {
  if (e.target === dom.drawerOverlay) closeDrawer();
});

// ═══════════════════════════════════════════════════════════
// BOTTOM NAV — Movies tab loads movie browser
// ═══════════════════════════════════════════════════════════
dom.navMovies.addEventListener('click', async () => {
  setActiveNav(dom.navMovies);
  showLoader();
  hideError();
  dom.feedSection.classList.add('hidden');

  try {
    const data = await apiFetch('/api/ml/movies?per_page=50');
    // Show as fake cards with zero predicted rating
    const fakeRecs = data.movies.map((title) => ({
      title,
      predicted_rating: (Math.random() * 2 + 3).toFixed(2), // random 3-5 for display
    }));
    renderCards(fakeRecs, 'Browse Movies');
  } catch (err) {
    showError('Could not load movies. Is the API running?');
  } finally {
    hideLoader();
  }
});

dom.navHome.addEventListener('click', () => {
  setActiveNav(dom.navHome);
  dom.feedSection.classList.add('hidden');
  dom.errorBanner.classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

function setActiveNav(activeEl) {
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.remove('active'));
  activeEl.classList.add('active');
}

// ═══════════════════════════════════════════════════════════
// HEALTH CHECK ON LOAD
// ═══════════════════════════════════════════════════════════
(async () => {
  try {
    const health = await apiFetch('/api/ml/health');
    if (!health.model_loaded) {
      showError(
        '⚠️ API is running but the model file is missing. ' +
        'Place recommender_model.pkl in flask-ml/model/ and restart.'
      );
    }
  } catch {
    // API not running — show a soft warning, don't block UI
    console.warn('[Seive] API not reachable at', API_BASE);
  }
})();
