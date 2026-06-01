// Frontend API wrapper for Flask backend
// Exposes helper functions under window.Api

const API_BASE = window.API_BASE || (window.__API_BASE__ = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:5000' : 'https://seive-flask.onrender.com'));

async function _request(path, opts = {}){
  const url = API_BASE + path;
  const headers = opts.headers || {};
  if (opts.json !== false && opts.body && typeof opts.body === 'object'){
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, {...opts, headers});
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    const text = await res.text();
    let err = text;
    try { err = JSON.parse(text); } catch(e){}
    const error = new Error('Request failed');
    error.status = res.status; error.body = err;
    throw error;
  }
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

const Api = {
  listMovies: (page=1, per_page=20) => _request(`/api/movies?page=${page}&per_page=${per_page}`),
  searchMovie: (title) => _request(`/api/movie/${encodeURIComponent(title)}`),
  listUsers: () => _request('/api/users'),
  recommendForUser: (user_id, top_n=10, exclude_seen=true) => _request(`/api/recommend/${user_id}?top_n=${top_n}&exclude_seen=${exclude_seen?1:0}`),
  recommendNewUser: (ratings, top_n=10) => _request('/api/recommend/new-user', {method: 'POST', body: {ratings, top_n}}),
  recompute: (user_id, top_n=10) => _request(`/api/recompute/${user_id}`, {method: 'POST', body: {top_n}}),
  postRating: (user_id, movie_id, rating) => _request('/api/ratings', {method: 'POST', body: {user_id, movie_id, rating}}),
  initSSE: (user_id, onmessage, onopen, onerror) => {
    if (typeof(EventSource)==='undefined') return null;
    const src = new EventSource(`${API_BASE}/sse/notifications?user_id=${user_id}`);
    src.onmessage = e => { if(onmessage) onmessage(e); };
    src.onopen = e => { if(onopen) onopen(e); };
    src.onerror = e => { if(onerror) onerror(e); };
    return src;
  }
};

// Expose globally
window.Api = Api;


