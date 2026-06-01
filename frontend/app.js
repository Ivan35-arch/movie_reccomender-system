// Flask API base URL — update for production deployment
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

async function fetchMovies(q = '', page=1, per_page=20){
  try{
    const url = q ? `/api/movie/${encodeURIComponent(q)}` : `/api/movies?page=${page}&per_page=${per_page}`;
    const res = await fetch(API_BASE + url);
    if(!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    return q ? data.results : data.movies;
  }catch(err){
    console.warn('fetchMovies', err);
    return [];
  }
}

function createCard(movie){
  const tpl = document.getElementById('movie-card-tpl');
  const node = tpl.content.cloneNode(true);
  const article = node.querySelector('.movie-card');
  const img = article.querySelector('.poster');
  const title = article.querySelector('.title');
  const year = article.querySelector('.year');
  const overview = article.querySelector('.overview');

  img.src = movie.poster_url || 'https://via.placeholder.com/342x513?text=No+Image';
  img.alt = movie.title;
  title.textContent = movie.title;
  year.textContent = movie.release_year || '';
  overview.textContent = (movie.overview || '').slice(0,120) + (movie.overview && movie.overview.length>120 ? '…':'');

  const stars = article.querySelectorAll('.star');
  stars.forEach(s => s.addEventListener('click', ()=>onRate(movie, +s.dataset.value, article)));

  return node;
}

async function renderMovies(q){
  const container = document.getElementById('movies');
  container.innerHTML = '';
  const movies = await fetchMovies(q);
  if(!movies || movies.length===0){
    container.innerHTML = '<div class="muted">No movies found.</div>';
    return;
  }
  movies.forEach(m => container.appendChild(createCard(m)));
}

async function onRate(movie, value, cardEl){
  // optimistic UI
  const stars = cardEl.querySelectorAll('.star');
  stars.forEach(s => s.classList.toggle('active', +s.dataset.value <= value));

  // send rating to Flask API
  const user_id = 1; // placeholder; in production, use authenticated user_id
  try{
    await fetch(API_BASE + '/api/ratings', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id, movie_id: movie.id || movie.movielens_id, rating: value })
    });

    // trigger recompute on Flask
    await fetch(API_BASE + `/api/recompute/${user_id}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ top_n:5 }) });

    // update recommendations panel
    showEvent('Rated: ' + movie.title + ' → ' + value);
    await fetchRecommendations(user_id);
  }catch(err){
    console.warn('rating failed', err);
    showEvent('Rating failed (network)');
  }
}

async function fetchRecommendations(user_id = 1){
  try{
    const res = await fetch(API_BASE + `/api/recommend/${user_id}?top_n=10`);
    if(!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('recommendations');
    list.innerHTML = '';
    (data.recommendations || []).slice(0,8).forEach(r =>{
      const li = document.createElement('li'); li.className='rec-item';
      const img = document.createElement('img'); img.src = r.poster_url || 'https://via.placeholder.com/80x120';
      const div = document.createElement('div'); div.innerHTML = `<strong>${r.title}</strong><div class="muted small">pred ${r.predicted_rating}</div>`;
      li.appendChild(img); li.appendChild(div); list.appendChild(li);
    });
  }catch(e){console.warn(e)}
}

function showEvent(msg){
  const events = document.getElementById('events');
  const p = document.createElement('div'); p.textContent = `${new Date().toLocaleTimeString()} — ${msg}`; events.prepend(p);
}

function initSSE(user_id = 1){
  if(typeof(EventSource)==='undefined') return showEvent('SSE not supported');
  const sse = new EventSource(`${API_BASE}/sse/notifications?user_id=${user_id}`);
  const status = document.getElementById('sse-status');
  sse.onopen = ()=>{ status.textContent='connected'; showEvent('SSE connected') };
  sse.onmessage = e=>{ showEvent('Notification: '+e.data); fetchRecommendations(user_id); }
  sse.onerror = ()=>{ status.textContent='disconnected'; showEvent('SSE error') }
}

// wire controls
document.getElementById('btn-search').addEventListener('click', ()=>{
  const q = document.getElementById('search').value.trim(); renderMovies(q);
});

// init
renderMovies(); fetchRecommendations(); initSSE();
