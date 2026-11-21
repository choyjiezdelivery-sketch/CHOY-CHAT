const API = '/api';

const feedEl = document.getElementById('feed');
const formEl = document.getElementById('post-form');
const statusEl = document.getElementById('form-status');

function timeAgo(iso) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const units = [
    ['m', 60],
    ['h', 3600],
    ['d', 86400],
  ];
  let label = 'just now';
  for (const [suffix, size] of units) {
    if (seconds >= size) label = `${Math.floor(seconds / size)}${suffix} ago`;
  }
  return label;
}

function render(posts) {
  if (!posts.length) {
    feedEl.innerHTML = '<li class="empty">No posts yet — be the first!</li>';
    return;
  }
  feedEl.innerHTML = posts
    .map(
      (post) => `
        <li>
          <div class="meta">
            <span class="author">@${post.author}</span>
            <span>${timeAgo(post.createdAt)}</span>
          </div>
          <p>${escapeHtml(post.body)}</p>
          <div class="meta"><span>${post.likes.length} likes</span></div>
        </li>`,
    )
    .join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

async function loadFeed() {
  try {
    const res = await fetch(`${API}/posts`);
    const data = await res.json();
    render(data.posts ?? []);
  } catch {
    feedEl.innerHTML = '<li class="empty">Could not reach the API.</li>';
  }
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const author = formEl.author.value.trim();
  const body = formEl.body.value.trim();
  if (!author || !body) return;

  statusEl.textContent = 'Posting...';
  try {
    const res = await fetch(`${API}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, body }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    formEl.body.value = '';
    statusEl.textContent = 'Posted!';
    await loadFeed();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  }
});

loadFeed();
