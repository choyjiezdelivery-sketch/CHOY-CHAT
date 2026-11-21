/* ==========================================================================
   CHOY-CHAT — single-page client
   No framework, no build step. Hash router + fetch API + WebSocket events.
   ========================================================================== */
'use strict';

/* ------------------------------------------------------------------- state */

const State = {
  token: localStorage.getItem('choy.token') || null,
  me: null,
  route: '',
  unreadNotifs: 0,
  unreadMsgs: 0,
  friendRequests: 0,
  activeThread: null,
  call: null,
  gpsRefresh: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ helpers */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  const s = String(name || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(then).toLocaleDateString();
}

function avatarHtml(user, size = '') {
  const cls = `avatar ${size}`.trim();
  if (user && user.avatarUrl) {
    return `<span class="${cls}"><img src="${esc(user.avatarUrl)}" alt="${esc(user.displayName || user.username)}" /></span>`;
  }
  const color = (user && user.avatarColor) || '#6c5ce7';
  const label = initials(user && (user.displayName || user.username));
  return `<span class="${cls}" style="background:${esc(color)}">${esc(label)}</span>`;
}

function toast(title, body = '', kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<strong>${esc(title)}</strong>${body ? `<span>${esc(body)}</span>` : ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* --------------------------------------------------------------------- api */

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (State.token) headers.Authorization = `Bearer ${State.token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_err) {
    data = { error: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ modals */

function openModal(html, { wide = false } = {}) {
  const root = $('#modal-root');
  const body = $('#modal-body');
  body.className = `modal${wide ? ' wide' : ''}`;
  body.innerHTML = html;
  root.classList.remove('hidden');
  $$('[data-close-modal]', root).forEach((el) =>
    el.addEventListener('click', () => closeModal())
  );
  return body;
}

function closeModal() {
  $('#modal-root').classList.add('hidden');
  $('#modal-body').innerHTML = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* -------------------------------------------------------------------- auth */

function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

function paintMe() {
  const me = State.me;
  if (!me) return;
  $('#me-avatar').innerHTML = me.avatarUrl
    ? `<img src="${esc(me.avatarUrl)}" alt="" />`
    : esc(initials(me.displayName || me.username));
  const side = $('#side-avatar');
  if (side) {
    side.outerHTML = avatarHtml(me, 'sm').replace('class="avatar sm"', 'class="avatar sm" id="side-avatar"');
  }
  $('#side-name').textContent = me.displayName || me.username;
  $('#side-handle').textContent = `@${me.username}`;
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', me.role !== 'admin'));
}

async function loadMe() {
  const { user } = await api('/users/me');
  State.me = user;
  paintMe();
  return user;
}

async function login(identifier, password) {
  const data = await api('/auth/login', { method: 'POST', body: { identifier, password } });
  State.token = data.token;
  localStorage.setItem('choy.token', data.token);
  State.me = data.user;
  await boot();
}

async function register(payload) {
  const data = await api('/auth/register', { method: 'POST', body: payload });
  State.token = data.token;
  localStorage.setItem('choy.token', data.token);
  State.me = data.user;
  await boot();
}

function logout() {
  State.token = null;
  State.me = null;
  localStorage.removeItem('choy.token');
  if (window.ChoyRealtime) window.ChoyRealtime.disconnect();
  showAuth();
  location.hash = '';
}

/* ------------------------------------------------------------------ badges */

function setBadge(sel, n) {
  const el = $(sel);
  if (!el) return;
  if (n > 0) {
    el.textContent = n > 99 ? '99+' : String(n);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

async function refreshBadges() {
  try {
    const [notifs, convs, friends] = await Promise.all([
      api('/notifications'),
      api('/messages'),
      api('/friends'),
    ]);
    State.unreadNotifs = notifs.unread || 0;
    State.unreadMsgs = (convs.conversations || []).reduce((n, c) => n + (c.unread || 0), 0);
    State.friendRequests = (friends.incoming || []).length;
    setBadge('#notif-badge', State.unreadNotifs);
    setBadge('#msg-badge', State.unreadMsgs);
    setBadge('#friend-badge', State.friendRequests);
  } catch (_err) {
    /* badges are best-effort */
  }
}

/* ------------------------------------------------------------------ router */

const routes = {
  feed: renderFeed,
  profile: renderProfile,
  messages: renderMessages,
  gps: renderGps,
  groups: renderGroups,
  friends: renderFriends,
  video: renderVideo,
  settings: renderSettings,
  admin: renderAdmin,
  search: renderSearch,
};

function parseHash() {
  const raw = (location.hash || '#/feed').replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { page: parts[0] || 'feed', arg: parts[1] || null, params: new URLSearchParams(query || '') };
}

async function route() {
  if (!State.me) return;
  const { page, arg, params } = parseHash();
  State.route = page;
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.nav === page));
  $('#sidebar').classList.remove('open');

  const fn = routes[page] || renderFeed;
  const content = $('#content');
  content.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await fn(content, arg, params);
  } catch (err) {
    content.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="error">${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}

window.addEventListener('hashchange', route);

/* ==========================================================================
   POST RENDERING
   ========================================================================== */

function postHtml(post) {
  const author = post.author || {};
  const media = post.mediaUrl
    ? post.mediaType === 'video'
      ? `<div class="post-media"><video src="${esc(post.mediaUrl)}" controls preload="metadata"></video></div>`
      : `<div class="post-media"><img src="${esc(post.mediaUrl)}" alt="" loading="lazy" /></div>`
    : '';

  const quote = post.original
    ? `<div class="post-quote">
         <div class="q-head">${avatarHtml(post.original.author, 'sm')}
           <strong>${esc(post.original.author.displayName)}</strong>
           <span class="muted">@${esc(post.original.author.username)} · ${timeAgo(post.original.createdAt)}</span>
         </div>
         <div>${esc(post.original.body)}</div>
         ${post.original.mediaUrl && post.original.mediaType === 'image' ? `<img src="${esc(post.original.mediaUrl)}" alt="" style="max-width:100%;border-radius:8px;margin-top:.4rem" />` : ''}
       </div>`
    : '';

  const mine = State.me && author.id === State.me.id;

  return `
  <article class="post" data-post="${post.id}">
    <div class="post-head">
      <a href="#/profile/${esc(author.username)}">${avatarHtml(author)}</a>
      <div class="who">
        <strong><a href="#/profile/${esc(author.username)}" style="color:inherit">${esc(author.displayName)}</a></strong>
        <span>@${esc(author.username)} · ${timeAgo(post.createdAt)}</span>
      </div>
      ${mine ? `<button class="icon-btn" data-del-post="${post.id}" title="Delete post">🗑️</button>` : ''}
    </div>
    ${post.body ? `<div class="post-body">${esc(post.body)}</div>` : ''}
    ${media}
    ${quote}
    <div class="post-stats">
      <span data-like-count="${post.id}">${post.likeCount} like${post.likeCount === 1 ? '' : 's'}</span>
      <span data-comment-count="${post.id}">${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}</span>
      <span data-share-count="${post.id}">${post.shareCount || 0} share${(post.shareCount || 0) === 1 ? '' : 's'}</span>
    </div>
    <div class="post-actions">
      <button data-like="${post.id}" class="${post.liked ? 'liked' : ''}">${post.liked ? '❤️' : '🤍'} Like</button>
      <button data-comments="${post.id}">💬 Comment</button>
      <button data-share="${post.id}">🔁 Share</button>
      <button data-bookmark="${post.id}" class="${post.bookmarked ? 'on' : ''}">${post.bookmarked ? '🔖' : '📑'} Save</button>
    </div>
    <div class="comments hidden" data-comments-box="${post.id}"></div>
  </article>`;
}

function bindPostEvents(root) {
  if (root._postBound) return;
  root._postBound = true;

  root.addEventListener('click', async (e) => {
    const likeBtn = e.target.closest('[data-like]');
    const commentBtn = e.target.closest('[data-comments]');
    const shareBtn = e.target.closest('[data-share]');
    const bookmarkBtn = e.target.closest('[data-bookmark]');
    const delBtn = e.target.closest('[data-del-post]');

    if (likeBtn) {
      const id = likeBtn.dataset.like;
      const on = likeBtn.classList.contains('liked');
      try {
        const data = await api(`/posts/${id}/like`, { method: on ? 'DELETE' : 'POST' });
        likeBtn.classList.toggle('liked', data.liked);
        likeBtn.innerHTML = `${data.liked ? '❤️' : '🤍'} Like`;
        const counter = root.querySelector(`[data-like-count="${id}"]`);
        if (counter) counter.textContent = `${data.likeCount} like${data.likeCount === 1 ? '' : 's'}`;
      } catch (err) {
        toast('Could not update like', err.message, 'err');
      }
      return;
    }

    if (commentBtn) {
      const id = commentBtn.dataset.comments;
      const box = root.querySelector(`[data-comments-box="${id}"]`);
      if (!box) return;
      if (!box.classList.contains('hidden')) {
        box.classList.add('hidden');
        return;
      }
      box.classList.remove('hidden');
      box.innerHTML = '<div class="skeleton"></div>';
      await loadComments(id, box);
      return;
    }

    if (shareBtn) {
      const id = shareBtn.dataset.share;
      const body = openModal(`
        <div class="modal-head"><h2>Share post</h2><button class="icon-btn" data-close-modal>✕</button></div>
        <div class="field"><label>Add a note (optional)</label>
          <textarea id="share-note" maxlength="500" placeholder="Say something about this…"></textarea></div>
        <div class="row" style="margin-top:.8rem">
          <button class="btn primary" id="share-go">Share to my feed</button>
          <button class="btn ghost" data-close-modal>Cancel</button>
        </div>`);
      $('#share-go', body).addEventListener('click', async () => {
        try {
          await api(`/posts/${id}/share`, { method: 'POST', body: { body: $('#share-note', body).value } });
          closeModal();
          toast('Shared', 'It is now on your timeline', 'ok');
          route();
        } catch (err) {
          toast('Share failed', err.message, 'err');
        }
      });
      return;
    }

    if (bookmarkBtn) {
      const id = bookmarkBtn.dataset.bookmark;
      const on = bookmarkBtn.classList.contains('on');
      try {
        await api(`/posts/${id}/bookmark`, { method: on ? 'DELETE' : 'POST' });
        bookmarkBtn.classList.toggle('on', !on);
        bookmarkBtn.innerHTML = `${!on ? '🔖' : '📑'} Save`;
      } catch (err) {
        toast('Could not save', err.message, 'err');
      }
      return;
    }

    if (delBtn) {
      const id = delBtn.dataset.delPost;
      if (!confirm('Delete this post?')) return;
      try {
        await api(`/posts/${id}`, { method: 'DELETE' });
        const card = root.querySelector(`[data-post="${id}"]`);
        if (card) card.remove();
        toast('Post deleted', '', 'ok');
      } catch (err) {
        toast('Delete failed', err.message, 'err');
      }
    }
  });
}

async function loadComments(postId, box) {
  try {
    const { comments } = await api(`/posts/${postId}/comments`);
    box.innerHTML = `
      ${comments.length ? comments.map((c) => `
        <div class="comment">
          ${avatarHtml(c.author, 'sm')}
          <div class="c-body">
            <strong>${esc(c.author.displayName)}</strong>
            <span class="muted small"> · ${timeAgo(c.createdAt)}</span>
            <p>${esc(c.body)}</p>
          </div>
        </div>`).join('') : '<p class="muted small">No comments yet.</p>'}
      <form class="comment-form" data-comment-form="${postId}">
        <input type="text" name="body" placeholder="Write a comment…" maxlength="300" required />
        <button class="btn primary small" type="submit">Send</button>
      </form>`;

    $('[data-comment-form]', box).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.body;
      const text = input.value.trim();
      if (!text) return;
      try {
        const { comment } = await api(`/posts/${postId}/comments`, { method: 'POST', body: { body: text } });
        input.value = '';
        const form = $('[data-comment-form]', box);
        const el = document.createElement('div');
        el.className = 'comment';
        el.innerHTML = `${avatarHtml(comment.author, 'sm')}
          <div class="c-body"><strong>${esc(comment.author.displayName)}</strong>
          <span class="muted small"> · just now</span><p>${esc(comment.body)}</p></div>`;
        box.insertBefore(el, form);
        const counter = document.querySelector(`[data-comment-count="${postId}"]`);
        if (counter) {
          const n = Number(counter.textContent.split(' ')[0]) + 1;
          counter.textContent = `${n} comment${n === 1 ? '' : 's'}`;
        }
      } catch (err) {
        toast('Comment failed', err.message, 'err');
      }
    });
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

/* ==========================================================================
   PAGE: NEWSFEED
   ========================================================================== */

async function renderFeed(root) {
  root.innerHTML = `
    <div class="card">
      <form class="composer" id="composer">
        <div class="row">
          ${avatarHtml(State.me, 'sm')}
          <textarea name="body" placeholder="What's on your mind, ${esc(State.me.displayName)}?" maxlength="500"></textarea>
        </div>
        <div id="composer-preview"></div>
        <div class="composer-bar">
          <label class="btn ghost small" style="cursor:pointer">
            🖼️ Photo <input type="file" id="pick-image" accept="image/*" hidden />
          </label>
          <label class="btn ghost small" style="cursor:pointer">
            🎬 Video <input type="file" id="pick-video" accept="video/*" hidden />
          </label>
          <span class="spacer"></span>
          <span class="muted small" id="composer-status"></span>
          <button class="btn primary small" type="submit">Post</button>
        </div>
      </form>
    </div>

    <div class="tabs-inline" id="feed-tabs">
      <button class="active" data-feed="all">All posts</button>
      <button data-feed="following">Following</button>
    </div>

    <div id="feed-list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;

  let pendingMedia = null;

  function setPreview(file, kind) {
    const box = $('#composer-preview');
    const url = URL.createObjectURL(file);
    box.innerHTML = `<div class="media-preview">
      ${kind === 'video' ? `<video src="${url}" controls></video>` : `<img src="${url}" alt="" />`}
      <button type="button" class="remove" id="clear-media">✕</button></div>`;
    $('#clear-media').addEventListener('click', () => {
      pendingMedia = null;
      box.innerHTML = '';
    });
  }

  $('#pick-image').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) {
      pendingMedia = { file: f, kind: 'image' };
      setPreview(f, 'image');
    }
  });
  $('#pick-video').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) {
      pendingMedia = { file: f, kind: 'video' };
      setPreview(f, 'video');
    }
  });

  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = form.body.value.trim();
    if (!body && !pendingMedia) return toast('Nothing to post', 'Add text or media', 'err');

    const status = $('#composer-status');
    try {
      let mediaUrl = null;
      let mediaType = 'none';
      if (pendingMedia) {
        status.textContent = 'Uploading…';
        const fd = new FormData();
        fd.append('file', pendingMedia.file);
        const up = await api('/media/upload', { method: 'POST', form: fd });
        mediaUrl = up.url;
        mediaType = up.mediaType;
        status.textContent = '';
      }
      await api('/posts', { method: 'POST', body: { body, mediaUrl, mediaType } });
      form.body.value = '';
      pendingMedia = null;
      $('#composer-preview').innerHTML = '';
      toast('Posted', '', 'ok');
      loadFeed();
    } catch (err) {
      status.textContent = '';
      toast('Post failed', err.message, 'err');
    }
  });

  let feedMode = 'all';
  $$('#feed-tabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('#feed-tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      feedMode = btn.dataset.feed;
      loadFeed();
    })
  );

  async function loadFeed() {
    const list = $('#feed-list');
    try {
      const { posts } = await api(`/posts?feed=${feedMode}&limit=30`);
      if (!posts.length) {
        list.innerHTML = `<div class="empty"><span class="big">📰</span>No posts yet. Be the first to post!</div>`;
        return;
      }
      list.innerHTML = posts.map(postHtml).join('');
      bindPostEvents(list);
    } catch (err) {
      list.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }

  await loadFeed();
}

/* ==========================================================================
   PAGE: PROFILE
   ========================================================================== */

async function renderProfile(root, username) {
  const target = username || State.me.username;
  const { user } = await api(`/users/${target}`);
  const isSelf = user.isSelf;

  root.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div class="profile-cover" ${user.coverUrl ? `style="background:url('${esc(user.coverUrl)}') center/cover"` : ''}></div>
      <div style="padding:1rem">
        <div class="profile-head">
          ${avatarHtml(user, 'xl')}
          <div style="flex:1;min-width:180px">
            <h1 style="margin:0">${esc(user.displayName)}</h1>
            <div class="muted">@${esc(user.username)} ${user.online ? '<span class="chip on">● online</span>' : ''}</div>
            ${user.bio ? `<p style="margin:.4rem 0 0">${esc(user.bio)}</p>` : ''}
            <div class="row wrap small muted" style="margin-top:.4rem">
              ${user.location ? `<span>📍 ${esc(user.location)}</span>` : ''}
              ${user.website ? `<a href="${esc(user.website)}" target="_blank" rel="noopener">🔗 ${esc(user.website)}</a>` : ''}
              <span>Joined ${timeAgo(user.createdAt)}</span>
            </div>
          </div>
          <div class="row wrap">
            ${isSelf
              ? `<button class="btn" id="edit-profile">Edit profile</button>`
              : `<button class="btn primary" id="follow-btn">${user.isFollowing ? 'Following' : 'Follow'}</button>
                 <button class="btn" id="friend-btn">${user.friendState === 'friends' ? '✓ Friends' : user.friendState === 'outgoing' ? 'Requested' : user.friendState === 'incoming' ? 'Accept request' : 'Add friend'}</button>
                 <button class="btn" id="msg-btn">Message</button>
                 <button class="btn" id="call-btn">🎥 Call</button>`}
          </div>
        </div>
        <div class="grid four" style="margin-top:1rem">
          <div class="stat"><div class="n">${user.posts}</div><div class="l">Posts</div></div>
          <div class="stat"><div class="n">${user.friends}</div><div class="l">Friends</div></div>
          <div class="stat"><div class="n">${user.followers}</div><div class="l">Followers</div></div>
          <div class="stat"><div class="n">${user.following}</div><div class="l">Following</div></div>
        </div>
      </div>
    </div>

    <div class="section-title"><h2>${isSelf ? 'My posts' : 'Posts'}</h2></div>
    <div id="profile-posts"><div class="skeleton"></div></div>`;

  if (isSelf) {
    $('#edit-profile').addEventListener('click', () => openEditProfile());
  } else {
    $('#follow-btn').addEventListener('click', async (e) => {
      const on = e.target.textContent.trim() === 'Following';
      try {
        await api(`/users/${user.username}/follow`, { method: on ? 'DELETE' : 'POST' });
        e.target.textContent = on ? 'Follow' : 'Following';
      } catch (err) {
        toast('Failed', err.message, 'err');
      }
    });

    $('#friend-btn').addEventListener('click', async () => {
      try {
        if (user.friendState === 'incoming') {
          await api(`/friends/accept/${user.username}`, { method: 'POST' });
        } else if (user.friendState === 'friends') {
          if (!confirm('Remove this friend?')) return;
          await api(`/friends/${user.username}`, { method: 'DELETE' });
        } else {
          await api(`/friends/request/${user.username}`, { method: 'POST' });
        }
        route();
      } catch (err) {
        toast('Failed', err.message, 'err');
      }
    });

    $('#msg-btn').addEventListener('click', async () => {
      try {
        const { conversationId } = await api(`/messages/open/${user.username}`, { method: 'POST' });
        location.hash = `#/messages/${conversationId}`;
      } catch (err) {
        toast('Failed', err.message, 'err');
      }
    });

    $('#call-btn').addEventListener('click', () => startCall(user.username, 'video'));
  }

  const list = $('#profile-posts');
  const { posts } = await api(`/users/${user.username}/posts`);
  if (!posts.length) {
    list.innerHTML = `<div class="empty"><span class="big">📭</span>No posts yet.</div>`;
  } else {
    list.innerHTML = posts.map(postHtml).join('');
    bindPostEvents(list);
  }
}

function openEditProfile() {
  const me = State.me;
  const body = openModal(`
    <div class="modal-head"><h2>Edit profile</h2><button class="icon-btn" data-close-modal>✕</button></div>
    <div class="grid" style="gap:.7rem">
      <div class="field"><label>Display name</label><input id="ep-name" value="${esc(me.displayName)}" maxlength="50" /></div>
      <div class="field"><label>Bio</label><textarea id="ep-bio" maxlength="200">${esc(me.bio)}</textarea></div>
      <div class="field"><label>Location</label><input id="ep-loc" value="${esc(me.location)}" maxlength="60" /></div>
      <div class="field"><label>Website</label><input id="ep-web" value="${esc(me.website)}" maxlength="120" /></div>
      <div class="field"><label>Profile picture</label>
        <input type="file" id="ep-avatar" accept="image/*" />
        <span class="hint">Uploads immediately and sets your avatar.</span></div>
      <div class="field"><label>Cover photo</label>
        <input type="file" id="ep-cover" accept="image/*" /></div>
    </div>
    <div class="row" style="margin-top:.9rem">
      <button class="btn primary" id="ep-save">Save changes</button>
      <button class="btn ghost" data-close-modal>Cancel</button>
    </div>`);

  async function uploadInto(inputSel, field) {
    const file = $(inputSel, body).files[0];
    if (!file) return null;
    const fd = new FormData();
    fd.append('file', file);
    const up = await api('/media/upload', { method: 'POST', form: fd });
    return { [field]: up.url };
  }

  $('#ep-save', body).addEventListener('click', async () => {
    try {
      const patch = {
        displayName: $('#ep-name', body).value,
        bio: $('#ep-bio', body).value,
        location: $('#ep-loc', body).value,
        website: $('#ep-web', body).value,
      };
      const av = await uploadInto('#ep-avatar', 'avatarUrl');
      if (av) Object.assign(patch, av);
      const cv = await uploadInto('#ep-cover', 'coverUrl');
      if (cv) Object.assign(patch, cv);

      await api('/users/me', { method: 'PATCH', body: patch });
      await loadMe();
      closeModal();
      toast('Profile updated', '', 'ok');
      route();
    } catch (err) {
      toast('Update failed', err.message, 'err');
    }
  });
}

/* ==========================================================================
   PAGE: MESSAGES
   ========================================================================== */

async function renderMessages(root, conversationId) {
  root.innerHTML = `
    <div class="msg-layout">
      <div class="msg-list" id="conv-list"><div class="skeleton" style="margin:.7rem"></div></div>
      <div class="thread" id="thread">
        <div class="empty"><span class="big">✉️</span>Pick a conversation</div>
      </div>
    </div>`;

  const { conversations } = await api('/messages');
  const list = $('#conv-list');

  if (!conversations.length) {
    list.innerHTML = `<div class="empty"><span class="big">💬</span>No conversations yet.<br /><span class="small">Open someone's profile and tap Message.</span></div>`;
  } else {
    list.innerHTML = conversations
      .map(
        (c) => `
      <div class="msg-list-item ${String(c.id) === String(conversationId) ? 'active' : ''}" data-conv="${c.id}">
        ${avatarHtml(c.user, 'sm')}
        <div class="t">
          <strong>${esc(c.user.displayName)}</strong>
          <span>${c.lastMessage ? esc(c.lastMessage.body || `[${c.lastMessage.mediaType}]`) : 'No messages yet'}</span>
        </div>
        ${c.online ? '<span class="dot-online" title="Online"></span>' : ''}
        ${c.unread ? `<span class="badge" style="position:static">${c.unread}</span>` : ''}
      </div>`
      )
      .join('');

    $$('[data-conv]', list).forEach((el) =>
      el.addEventListener('click', () => {
        location.hash = `#/messages/${el.dataset.conv}`;
      })
    );
  }

  if (conversationId) await openThread(conversationId);
}

async function openThread(conversationId) {
  const thread = $('#thread');
  if (!thread) return;
  State.activeThread = { kind: 'dm', id: Number(conversationId) };

  const data = await api(`/messages/${conversationId}`);
  thread.innerHTML = `
    <div class="thread-head">
      ${avatarHtml(data.user, 'sm')}
      <div style="flex:1">
        <strong>${esc(data.user.displayName)}</strong>
        <div class="muted small">@${esc(data.user.username)} ${data.online ? '· online' : ''}</div>
      </div>
      <button class="btn small" id="thread-call">🎥 Call</button>
    </div>
    <div class="thread-body" id="thread-body">
      ${data.messages.map((m) => bubbleHtml(m)).join('')}
    </div>
    <div class="typing" id="typing"></div>
    <form class="thread-form" id="thread-form">
      <label class="icon-btn" style="cursor:pointer" title="Attach">
        📎<input type="file" id="thread-file" accept="image/*,video/*,audio/*" hidden />
      </label>
      <input type="text" name="body" placeholder="Write a message…" autocomplete="off" maxlength="1000" />
      <button class="btn primary" type="submit">Send</button>
    </form>`;

  const body = $('#thread-body');
  body.scrollTop = body.scrollHeight;

  $('#thread-call').addEventListener('click', () => startCall(data.user.username, 'video'));

  $('#thread-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api('/media/upload', { method: 'POST', form: fd });
      const { message } = await api(`/messages/${conversationId}`, {
        method: 'POST',
        body: { body: '', mediaType: up.mediaType, mediaUrl: up.url },
      });
      body.insertAdjacentHTML('beforeend', bubbleHtml(message));
      body.scrollTop = body.scrollHeight;
    } catch (err) {
      toast('Upload failed', err.message, 'err');
    }
    e.target.value = '';
  });

  const form = $('#thread-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.body.value.trim();
    if (!text) return;
    form.body.value = '';
    try {
      const { message } = await api(`/messages/${conversationId}`, { method: 'POST', body: { body: text } });
      body.insertAdjacentHTML('beforeend', bubbleHtml(message));
      body.scrollTop = body.scrollHeight;
    } catch (err) {
      toast('Send failed', err.message, 'err');
    }
  });

  form.body.addEventListener('input', () => {
    if (window.ChoyRealtime) {
      window.ChoyRealtime.send({ type: 'typing', conversationId: Number(conversationId) });
    }
  });
}

function bubbleHtml(m) {
  let media = '';
  if (m.mediaUrl) {
    if (m.mediaType === 'image') media = `<img src="${esc(m.mediaUrl)}" alt="" loading="lazy" />`;
    else if (m.mediaType === 'video') media = `<video src="${esc(m.mediaUrl)}" controls preload="metadata"></video>`;
    else if (m.mediaType === 'audio') media = `<audio src="${esc(m.mediaUrl)}" controls></audio>`;
    else if (m.mediaType === 'link') media = `<a href="${esc(m.mediaUrl)}" target="_blank" rel="noopener">${esc(m.mediaUrl)}</a>`;
  }
  return `<div class="bubble ${m.mine ? 'mine' : ''}" data-msg="${m.id}">
    ${media}${m.body ? esc(m.body) : ''}
    <div class="meta">${timeAgo(m.createdAt)}</div>
  </div>`;
}

/* ==========================================================================
   PAGE: GROUPS
   ========================================================================== */

async function renderGroups(root, groupId) {
  root.innerHTML = `
    <div class="row" style="margin-bottom:.8rem">
      <h1 style="margin:0;flex:1">Group messages</h1>
      <button class="btn primary small" id="new-group">+ New group</button>
    </div>
    <div class="msg-layout">
      <div class="msg-list" id="group-list"><div class="skeleton" style="margin:.7rem"></div></div>
      <div class="thread" id="group-thread">
        <div class="empty"><span class="big">👥</span>Pick a group</div>
      </div>
    </div>`;

  $('#new-group').addEventListener('click', openNewGroup);

  const { groups } = await api('/groups');
  const list = $('#group-list');
  if (!groups.length) {
    list.innerHTML = `<div class="empty"><span class="big">👥</span>No groups yet.</div>`;
  } else {
    list.innerHTML = groups
      .map(
        (g) => `
      <div class="group-item ${String(g.id) === String(groupId) ? 'active' : ''}" data-group="${g.id}">
        <div class="group-avatar" style="background:${esc(g.avatarColor)}">${esc(initials(g.name))}</div>
        <div class="t" style="flex:1;min-width:0">
          <strong>${esc(g.name)}</strong>
          <div class="muted small">${g.memberCount} member${g.memberCount === 1 ? '' : 's'}</div>
        </div>
      </div>`
      )
      .join('');
    $$('[data-group]', list).forEach((el) =>
      el.addEventListener('click', () => {
        location.hash = `#/groups/${el.dataset.group}`;
      })
    );
  }

  if (groupId) await openGroupThread(groupId);
}

async function openGroupThread(groupId) {
  const thread = $('#group-thread');
  if (!thread) return;
  State.activeThread = { kind: 'group', id: Number(groupId) };

  const data = await api(`/groups/${groupId}/messages`);
  thread.innerHTML = `
    <div class="thread-head">
      <div class="group-avatar" style="background:${esc(data.group.avatarColor)}">${esc(initials(data.group.name))}</div>
      <div style="flex:1">
        <strong>${esc(data.group.name)}</strong>
        <div class="muted small">${data.group.memberCount} members</div>
      </div>
      <button class="btn small" id="group-info">Members</button>
    </div>
    <div class="thread-body" id="group-body">
      ${data.messages.map((m) => groupBubbleHtml(m)).join('')}
    </div>
    <div class="typing" id="group-typing"></div>
    <form class="thread-form" id="group-form">
      <label class="icon-btn" style="cursor:pointer" title="Attach">
        📎<input type="file" id="group-file" accept="image/*,video/*,audio/*" hidden />
      </label>
      <input type="text" name="body" placeholder="Message the group…" autocomplete="off" maxlength="1000" />
      <button class="btn primary" type="submit">Send</button>
    </form>`;

  const body = $('#group-body');
  body.scrollTop = body.scrollHeight;

  $('#group-info').addEventListener('click', () => openGroupMembers(data.group));

  $('#group-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api('/media/upload', { method: 'POST', form: fd });
      const { message } = await api(`/groups/${groupId}/messages`, {
        method: 'POST',
        body: { body: '', mediaType: up.mediaType, mediaUrl: up.url },
      });
      body.insertAdjacentHTML('beforeend', groupBubbleHtml(message));
      body.scrollTop = body.scrollHeight;
    } catch (err) {
      toast('Upload failed', err.message, 'err');
    }
    e.target.value = '';
  });

  const form = $('#group-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.body.value.trim();
    if (!text) return;
    form.body.value = '';
    try {
      const { message } = await api(`/groups/${groupId}/messages`, { method: 'POST', body: { body: text } });
      body.insertAdjacentHTML('beforeend', groupBubbleHtml(message));
      body.scrollTop = body.scrollHeight;
    } catch (err) {
      toast('Send failed', err.message, 'err');
    }
  });

  form.body.addEventListener('input', () => {
    if (window.ChoyRealtime) {
      window.ChoyRealtime.send({ type: 'group:typing', groupId: Number(groupId) });
    }
  });
}

function groupBubbleHtml(m) {
  let media = '';
  if (m.mediaUrl) {
    if (m.mediaType === 'image') media = `<img src="${esc(m.mediaUrl)}" alt="" loading="lazy" />`;
    else if (m.mediaType === 'video') media = `<video src="${esc(m.mediaUrl)}" controls preload="metadata"></video>`;
    else if (m.mediaType === 'audio') media = `<audio src="${esc(m.mediaUrl)}" controls></audio>`;
  }
  return `<div class="bubble ${m.mine ? 'mine' : ''}">
    ${!m.mine ? `<div class="meta" style="opacity:.9;font-weight:700">${esc(m.author.displayName)}</div>` : ''}
    ${media}${m.body ? esc(m.body) : ''}
    <div class="meta">${timeAgo(m.createdAt)}</div>
  </div>`;
}

function openNewGroup() {
  const body = openModal(`
    <div class="modal-head"><h2>New group</h2><button class="icon-btn" data-close-modal>✕</button></div>
    <div class="field"><label>Group name</label><input id="ng-name" maxlength="60" placeholder="e.g. Weekend Trip" /></div>
    <div class="field"><label>Add members (comma-separated usernames)</label>
      <input id="ng-members" placeholder="maya, juan" /></div>
    <div class="row" style="margin-top:.9rem">
      <button class="btn primary" id="ng-create">Create group</button>
      <button class="btn ghost" data-close-modal>Cancel</button>
    </div>`);

  $('#ng-create', body).addEventListener('click', async () => {
    const name = $('#ng-name', body).value.trim();
    const members = $('#ng-members', body)
      .value.split(',')
      .map((s) => s.trim().replace(/^@/, ''))
      .filter(Boolean);
    if (!name) return toast('Name required', '', 'err');
    try {
      const { group } = await api('/groups', { method: 'POST', body: { name, members } });
      closeModal();
      toast('Group created', group.name, 'ok');
      location.hash = `#/groups/${group.id}`;
    } catch (err) {
      toast('Failed', err.message, 'err');
    }
  });
}

function openGroupMembers(group) {
  const body = openModal(`
    <div class="modal-head"><h2>${esc(group.name)}</h2><button class="icon-btn" data-close-modal>✕</button></div>
    <div class="grid" style="gap:.4rem">
      ${group.members
        .map(
          (m) => `<div class="gps-row">${avatarHtml(m, 'sm')}
            <div style="flex:1"><strong>${esc(m.displayName)}</strong>
            <div class="muted small">@${esc(m.username)}${m.role === 'owner' ? ' · owner' : ''}</div></div>
            ${group.isOwner && m.role !== 'owner' ? `<button class="btn small danger" data-remove="${esc(m.username)}">Remove</button>` : ''}
          </div>`
        )
        .join('')}
    </div>
    <div class="field" style="margin-top:.8rem"><label>Add member by username</label>
      <div class="row"><input id="gm-add" placeholder="username" />
      <button class="btn" id="gm-add-btn">Add</button></div></div>`);

  $$('[data-remove]', body).forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await api(`/groups/${group.id}/members/${btn.dataset.remove}`, { method: 'DELETE' });
        closeModal();
        route();
      } catch (err) {
        toast('Failed', err.message, 'err');
      }
    })
  );

  $('#gm-add-btn', body).addEventListener('click', async () => {
    const username = $('#gm-add', body).value.trim();
    if (!username) return;
    try {
      await api(`/groups/${group.id}/members`, { method: 'POST', body: { username } });
      closeModal();
      route();
    } catch (err) {
      toast('Failed', err.message, 'err');
    }
  });
}

/* ==========================================================================
   PAGE: FRIENDS
   ========================================================================== */

async function renderFriends(root) {
  root.innerHTML = `
    <h1>Friends</h1>
    <div class="card">
      <div class="field"><label>Find people</label>
        <input id="friend-search" placeholder="Search by name or username…" /></div>
      <div id="friend-results" style="margin-top:.7rem"></div>
    </div>
    <div id="friend-sections"><div class="skeleton"></div></div>`;

  const searchInput = $('#friend-search');
  let timer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = searchInput.value.trim();
      const box = $('#friend-results');
      if (!q) {
        box.innerHTML = '';
        return;
      }
      try {
        const { users } = await api(`/friends/search?q=${encodeURIComponent(q)}`);
        box.innerHTML = users.length
          ? users
              .map(
                (u) => `<div class="gps-row">${avatarHtml(u, 'sm')}
                  <div style="flex:1"><strong>${esc(u.displayName)}</strong>
                  <div class="muted small">@${esc(u.username)}</div></div>
                  <button class="btn small primary" data-add="${esc(u.username)}">${
                    u.requestState === 'outgoing' ? 'Requested' : u.requestState === 'incoming' ? 'Accept' : 'Add'
                  }</button></div>`
              )
              .join('')
          : '<p class="muted small">No one found.</p>';

        $$('[data-add]', box).forEach((btn) =>
          btn.addEventListener('click', async () => {
            try {
              await api(`/friends/request/${btn.dataset.add}`, { method: 'POST' });
              btn.textContent = 'Requested';
              btn.disabled = true;
              toast('Request sent', '', 'ok');
            } catch (err) {
              toast('Failed', err.message, 'err');
            }
          })
        );
      } catch (err) {
        box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      }
    }, 300);
  });

  const data = await api('/friends');
  const sections = $('#friend-sections');

  sections.innerHTML = `
    ${data.incoming.length ? `
      <div class="section-title"><h2>Friend requests (${data.incoming.length})</h2></div>
      <div class="card">
        ${data.incoming.map((u) => `
          <div class="gps-row" style="margin-bottom:.4rem">${avatarHtml(u, 'sm')}
            <div style="flex:1"><strong>${esc(u.displayName)}</strong>
            <div class="muted small">@${esc(u.username)}</div></div>
            <button class="btn small primary" data-accept="${esc(u.username)}">Accept</button>
            <button class="btn small ghost" data-decline="${esc(u.username)}">Decline</button>
          </div>`).join('')}
      </div>` : ''}

    ${data.outgoing.length ? `
      <div class="section-title"><h2>Sent requests (${data.outgoing.length})</h2></div>
      <div class="card">
        ${data.outgoing.map((u) => `
          <div class="gps-row" style="margin-bottom:.4rem">${avatarHtml(u, 'sm')}
            <div style="flex:1"><strong>${esc(u.displayName)}</strong>
            <div class="muted small">@${esc(u.username)} · pending</div></div>
          </div>`).join('')}
      </div>` : ''}

    <div class="section-title"><h2>My friends (${data.friends.length})</h2></div>
    <div class="card">
      ${data.friends.length
        ? data.friends.map((u) => `
          <div class="gps-row" style="margin-bottom:.4rem">${avatarHtml(u, 'sm')}
            <div style="flex:1"><strong>${esc(u.displayName)}</strong>
            <div class="muted small">@${esc(u.username)}</div></div>
            <a class="btn small" href="#/profile/${esc(u.username)}">Profile</a>
            <button class="btn small" data-msg="${esc(u.username)}">Message</button>
          </div>`).join('')
        : '<p class="muted">No friends yet — search above to add some.</p>'}
    </div>`;

  $$('[data-accept]', sections).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/friends/accept/${b.dataset.accept}`, { method: 'POST' });
        toast('Friend added', '', 'ok');
        route();
      } catch (err) {
        toast('Failed', err.message, 'err');
      }
    })
  );
  $$('[data-decline]', sections).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api(`/friends/decline/${b.dataset.decline}`, { method: 'POST' });
        route();
      } catch (err) {
        toast('Failed', err.message, 'err');
      }
    })
  );
  $$('[data-msg]', sections).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        const { conversationId } = await api(`/messages/open/${b.dataset.msg}`, { method: 'POST' });
        location.hash = `#/messages/${conversationId}`;
      } catch (err) {
        toast('Failed', err.message, 'err');
      }
    })
  );
}

/* ==========================================================================
   PAGE: LIVE GPS
   ========================================================================== */

async function renderGps(root) {
  root.innerHTML = `
    <h1>Live GPS</h1>
    <div class="card">
      <div class="row wrap">
        <button class="btn primary" id="gps-share">📍 Share my location</button>
        <button class="btn ghost" id="gps-stop">Stop sharing</button>
        <span class="spacer"></span>
        <span class="chip" id="gps-state">Not sharing</span>
      </div>
      <p class="hint" style="margin-top:.6rem">
        Your position is only visible to your friends, and only while sharing is on.
        Browsers require HTTPS (or localhost) for location access.
      </p>
    </div>
    <div class="map-wrap">
      <div class="map-canvas" id="map"></div>
    </div>
    <div class="section-title"><h2>Friends nearby</h2></div>
    <div class="card" id="gps-friends"><div class="skeleton"></div></div>`;

  let watchId = null;

  async function loadLocations() {
    const box = $('#gps-friends');
    try {
      const { locations } = await api('/gps');
      const map = $('#map');
      if (!locations.length) {
        box.innerHTML = '<p class="muted">No friends are sharing their location right now.</p>';
        map.innerHTML = '<div class="empty" style="padding-top:6rem"><span class="big">🗺️</span>No pins to show</div>';
        return;
      }

      const lats = locations.map((l) => l.lat);
      const lngs = locations.map((l) => l.lng);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const spanLat = maxLat - minLat || 0.01;
      const spanLng = maxLng - minLng || 0.01;

      map.innerHTML = locations
        .map((l) => {
          const x = 10 + ((l.lng - minLng) / spanLng) * 80;
          const y = 90 - ((l.lat - minLat) / spanLat) * 80;
          return `<div class="pin" style="left:${x}%;top:${y}%">
            <div class="pin-dot"></div>
            <div class="pin-label">${esc(l.user.displayName)}</div>
          </div>`;
        })
        .join('');

      box.innerHTML = locations
        .map(
          (l) => `<div class="gps-row">${avatarHtml(l.user, 'sm')}
            <div style="flex:1"><strong>${esc(l.user.displayName)}</strong>
            <div class="muted small">${l.lat.toFixed(4)}, ${l.lng.toFixed(4)} · ${timeAgo(l.updatedAt)}</div></div>
            <a class="btn small" target="_blank" rel="noopener"
               href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=16/${l.lat}/${l.lng}">Open map</a>
          </div>`
        )
        .join('');
    } catch (err) {
      box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  }

  async function pushPosition(pos) {
    try {
      await api('/gps', {
        method: 'POST',
        body: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy },
      });
      $('#gps-state').textContent = 'Sharing live';
      $('#gps-state').classList.add('on');
    } catch (err) {
      toast('Could not share location', err.message, 'err');
    }
  }

  $('#gps-share').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Not supported', 'This browser has no geolocation', 'err');
    if (watchId != null) return;
    watchId = navigator.geolocation.watchPosition(pushPosition, (err) => {
      toast('Location error', err.message, 'err');
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
    toast('Sharing started', 'Your friends can see you now', 'ok');
  });

  $('#gps-stop').addEventListener('click', async () => {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    try {
      await api('/gps', { method: 'DELETE' });
      $('#gps-state').textContent = 'Not sharing';
      $('#gps-state').classList.remove('on');
      loadLocations();
    } catch (err) {
      toast('Failed', err.message, 'err');
    }
  });

  try {
    const { location } = await api('/gps/me');
    if (location && location.sharing) {
      $('#gps-state').textContent = 'Sharing live';
      $('#gps-state').classList.add('on');
    }
  } catch (_err) { /* ignore */ }

  await loadLocations();
  State.gpsRefresh = loadLocations;
}

/* ==========================================================================
   PAGE: VIDEO (calls)
   ========================================================================== */

async function renderVideo(root) {
  root.innerHTML = `
    <h1>Video</h1>
    <div class="card">
      <h3>Start a call</h3>
      <p class="muted small">Type a username to call them. They must be online with CHOY-CHAT open.</p>
      <div class="row wrap">
        <input id="call-user" placeholder="username" />
        <button class="btn primary" id="call-video">🎥 Video call</button>
        <button class="btn" id="call-audio">🎙️ Voice call</button>
      </div>
    </div>
    <div class="section-title"><h2>Recent calls</h2></div>
    <div class="card" id="call-history"><div class="skeleton"></div></div>`;

  $('#call-video').addEventListener('click', () => {
    const u = $('#call-user').value.trim();
    if (u) startCall(u, 'video');
  });
  $('#call-audio').addEventListener('click', () => {
    const u = $('#call-user').value.trim();
    if (u) startCall(u, 'audio');
  });

  const box = $('#call-history');
  try {
    const { calls } = await api('/calls/history');
    if (!calls.length) {
      box.innerHTML = '<p class="muted">No calls yet.</p>';
      return;
    }
    box.innerHTML = calls
      .map((c) => {
        const other = c.caller.id === State.me.id ? c.callee : c.caller;
        const dir = c.caller.id === State.me.id ? 'Outgoing' : 'Incoming';
        return `<div class="gps-row" style="margin-bottom:.4rem">${avatarHtml(other, 'sm')}
          <div style="flex:1"><strong>${esc(other.displayName)}</strong>
          <div class="muted small">${dir} · ${c.kind} · ${c.status} · ${timeAgo(c.startedAt)}</div></div>
          <button class="btn small" data-call-back="${esc(other.username)}">Call back</button>
        </div>`;
      })
      .join('');
    $$('[data-call-back]', box).forEach((b) =>
      b.addEventListener('click', () => startCall(b.dataset.callBack, 'video'))
    );
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

/* ==========================================================================
   PAGE: SETTINGS (username + PIN)
   ========================================================================== */

async function renderSettings(root) {
  const me = State.me;
  root.innerHTML = `
    <h1>Account settings</h1>

    <div class="card">
      <h3>Change username</h3>
      <p class="muted small">Your username is your @handle and your profile URL. Changing it requires your PIN if you have one set.</p>
      <div class="grid" style="gap:.6rem;max-width:420px">
        <div class="field"><label>New username</label>
          <input id="set-username" placeholder="lowercase, 3-20 chars" value="${esc(me.username)}" /></div>
        <div class="field"><label>PIN ${me.hasPin ? '' : '(no PIN set — not required)'}</label>
          <input id="set-username-pin" type="password" inputmode="numeric" placeholder="4-8 digits" /></div>
        <button class="btn primary" id="set-username-btn">Update username</button>
      </div>
    </div>

    <div class="card">
      <h3>Account PIN</h3>
      <p class="muted small">A 4-8 digit PIN protects sensitive changes like your username. ${me.hasPin ? 'A PIN is currently set.' : 'No PIN is set yet.'}</p>
      <div class="grid" style="gap:.6rem;max-width:420px">
        ${me.hasPin ? `<div class="field"><label>Current PIN</label>
          <input id="set-cur-pin" type="password" inputmode="numeric" placeholder="current PIN" /></div>` : ''}
        <div class="field"><label>${me.hasPin ? 'New PIN' : 'PIN'}</label>
          <input id="set-pin" type="password" inputmode="numeric" placeholder="4-8 digits" /></div>
        <div class="row">
          <button class="btn primary" id="set-pin-btn">${me.hasPin ? 'Change PIN' : 'Set PIN'}</button>
          ${me.hasPin ? '<button class="btn danger" id="remove-pin-btn">Remove PIN</button>' : ''}
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Password</h3>
      <div class="grid" style="gap:.6rem;max-width:420px">
        <div class="field"><label>Current password</label>
          <input id="set-cur-pass" type="password" autocomplete="current-password" /></div>
        <div class="field"><label>New password</label>
          <input id="set-new-pass" type="password" autocomplete="new-password" placeholder="at least 8 characters" /></div>
        <button class="btn primary" id="set-pass-btn">Change password</button>
      </div>
    </div>`;

  $('#set-username-btn').addEventListener('click', async () => {
    const username = $('#set-username').value.trim().toLowerCase();
    const pin = $('#set-username-pin').value;
    try {
      const data = await api('/users/me/username', { method: 'POST', body: { username, pin } });
      if (data.token) {
        State.token = data.token;
        localStorage.setItem('choy.token', data.token);
      }
      await loadMe();
      toast('Username updated', `You are now @${data.user.username}`, 'ok');
      route();
    } catch (err) {
      toast('Could not change username', err.message, 'err');
    }
  });

  $('#set-pin-btn').addEventListener('click', async () => {
    const pin = $('#set-pin').value;
    const currentPin = $('#set-cur-pin') ? $('#set-cur-pin').value : undefined;
    try {
      await api('/users/me/pin', { method: 'POST', body: { pin, currentPin } });
      await loadMe();
      toast('PIN saved', '', 'ok');
      route();
    } catch (err) {
      toast('Could not save PIN', err.message, 'err');
    }
  });

  const removeBtn = $('#remove-pin-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      const currentPin = $('#set-cur-pin').value;
      try {
        await api('/users/me/pin', { method: 'DELETE', body: { currentPin } });
        await loadMe();
        toast('PIN removed', '', 'ok');
        route();
      } catch (err) {
        toast('Could not remove PIN', err.message, 'err');
      }
    });
  }

  $('#set-pass-btn').addEventListener('click', async () => {
    try {
      await api('/users/me/password', {
        method: 'POST',
        body: { currentPassword: $('#set-cur-pass').value, newPassword: $('#set-new-pass').value },
      });
      toast('Password changed', '', 'ok');
      $('#set-cur-pass').value = '';
      $('#set-new-pass').value = '';
    } catch (err) {
      toast('Could not change password', err.message, 'err');
    }
  });
}

/* ==========================================================================
   PAGE: SEARCH
   ========================================================================== */

async function renderSearch(root, _arg, params) {
  const q = (params.get('q') || '').trim();
  root.innerHTML = `<h1>Search</h1><p class="muted">Results for “${esc(q)}”</p><div id="search-results"><div class="skeleton"></div></div>`;
  if (!q) {
    $('#search-results').innerHTML = '<div class="empty">Type something in the search bar above.</div>';
    return;
  }
  const data = await api(`/search?q=${encodeURIComponent(q)}`);
  const box = $('#search-results');
  box.innerHTML = `
    <div class="section-title"><h2>People (${data.users.length})</h2></div>
    <div class="card">
      ${data.users.length
        ? data.users.map((u) => `<div class="gps-row" style="margin-bottom:.4rem">${avatarHtml(u, 'sm')}
            <div style="flex:1"><strong>${esc(u.displayName)}</strong>
            <div class="muted small">@${esc(u.username)}</div></div>
            <a class="btn small" href="#/profile/${esc(u.username)}">View</a></div>`).join('')
        : '<p class="muted">No people found.</p>'}
    </div>
    <div class="section-title"><h2>Posts (${data.posts.length})</h2></div>
    <div id="search-posts">
      ${data.posts.length
        ? data.posts.map((p) => `<div class="card tight">
            <div class="row">${avatarHtml(p.author, 'sm')}
              <div><strong>${esc(p.author.displayName)}</strong>
              <div class="muted small">@${esc(p.author.username)} · ${timeAgo(p.createdAt)}</div></div></div>
            <p style="margin:.5rem 0 0">${esc(p.body)}</p></div>`).join('')
        : '<p class="muted">No posts found.</p>'}
    </div>`;
}

/* ==========================================================================
   PAGE: ADMIN DASHBOARD
   ========================================================================== */

async function renderAdmin(root) {
  if (!State.me || State.me.role !== 'admin') {
    root.innerHTML = '<div class="card"><h2>Admin only</h2><p class="muted">Your account does not have admin access.</p></div>';
    return;
  }

  root.innerHTML = `
    <div class="row" style="margin-bottom:.8rem">
      <h1 style="margin:0;flex:1">Admin dashboard</h1>
      <span class="chip on">Full access</span>
    </div>

    <div class="tabs-inline" id="admin-tabs">
      <button class="active" data-atab="overview">Overview</button>
      <button data-atab="users">Users</button>
      <button data-atab="posts">Posts</button>
      <button data-atab="security">🛡️ Security Studio</button>
      <button data-atab="github">GitHub</button>
      <button data-atab="supabase">Supabase</button>
      <button data-atab="env">Environment</button>
      <button data-atab="audit">Audit log</button>
    </div>
    <div id="admin-panel"><div class="skeleton"></div></div>`;

  const panel = $('#admin-panel');

  const tabs = {
    overview: adminOverview,
    users: adminUsers,
    posts: adminPosts,
    security: adminSecurity,
    github: adminGithub,
    supabase: adminSupabase,
    env: adminEnv,
    audit: adminAudit,
  };

  $$('#admin-tabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('#admin-tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      panel.innerHTML = '<div class="skeleton"></div>';
      tabs[btn.dataset.atab](panel);
    })
  );

  await adminOverview(panel);
}

async function adminOverview(panel) {
  const data = await api('/admin/overview');
  const c = data.counts;
  panel.innerHTML = `
    <div class="grid four">
      ${[
        ['Users', c.users], ['Admins', c.admins], ['Banned', c.banned], ['Posts', c.posts],
        ['Comments', c.comments], ['Likes', c.likes], ['Messages', c.messages], ['Groups', c.groups],
        ['Friendships', c.friendships], ['Pending requests', c.pendingRequests], ['Calls', c.calls], ['GPS sharing', c.gpsSharing],
      ].map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}
    </div>
    <div class="card" style="margin-top:.9rem">
      <h3>Server</h3>
      <div class="grid two">
        <div><span class="muted small">Uptime</span><div>${Math.floor(data.server.uptimeSeconds / 60)} min</div></div>
        <div><span class="muted small">Node</span><div>${esc(data.server.node)}</div></div>
        <div><span class="muted small">Memory (RSS)</span><div>${data.server.memoryMb} MB</div></div>
        <div><span class="muted small">Realtime</span><div>${data.realtime.connections} sockets · ${data.realtime.onlineUsers} online</div></div>
      </div>
    </div>`;
}

async function adminUsers(panel) {
  panel.innerHTML = `
    <div class="card">
      <div class="row"><input id="au-search" placeholder="Search users…" />
        <button class="btn" id="au-go">Search</button></div>
    </div>
    <div class="card" id="au-list"><div class="skeleton"></div></div>`;

  async function load(q = '') {
    const { users } = await api(`/admin/users?q=${encodeURIComponent(q)}`);
    $('#au-list').innerHTML = `
      <div class="scroll-x"><table class="table">
        <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Posts</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map((u) => `<tr>
            <td><strong>${esc(u.displayName)}</strong><div class="muted small">@${esc(u.username)}</div></td>
            <td class="muted small">${esc(u.email)}</td>
            <td>${u.role === 'admin' ? '<span class="chip on">admin</span>' : 'user'}</td>
            <td>${u.postCount}</td>
            <td>${u.isBanned ? '<span class="chip" style="color:var(--danger)">banned</span>' : '<span class="chip on">active</span>'}</td>
            <td class="row" style="gap:.3rem">
              <button class="btn small" data-role="${u.id}" data-next="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Demote' : 'Make admin'}</button>
              <button class="btn small ${u.isBanned ? '' : 'danger'}" data-ban="${u.id}" data-next="${u.isBanned ? 0 : 1}">${u.isBanned ? 'Unban' : 'Ban'}</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`;

    $$('[data-role]', panel).forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api(`/admin/users/${b.dataset.role}`, { method: 'PATCH', body: { role: b.dataset.next } });
          load($('#au-search').value);
        } catch (err) { toast('Failed', err.message, 'err'); }
      })
    );
    $$('[data-ban]', panel).forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api(`/admin/users/${b.dataset.ban}`, { method: 'PATCH', body: { isBanned: b.dataset.next === '1' } });
          load($('#au-search').value);
        } catch (err) { toast('Failed', err.message, 'err'); }
      })
    );
  }

  $('#au-go').addEventListener('click', () => load($('#au-search').value));
  $('#au-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(e.target.value); });
  await load();
}

async function adminPosts(panel) {
  panel.innerHTML = `
    <div class="card"><div class="row"><input id="ap-search" placeholder="Search posts…" />
      <button class="btn" id="ap-go">Search</button></div></div>
    <div class="card" id="ap-list"><div class="skeleton"></div></div>`;

  async function load(q = '') {
    const { posts } = await api(`/admin/posts?q=${encodeURIComponent(q)}`);
    $('#ap-list').innerHTML = posts.length
      ? `<div class="scroll-x"><table class="table">
          <thead><tr><th>#</th><th>Author</th><th>Body</th><th>Media</th><th>Likes</th><th></th></tr></thead>
          <tbody>${posts.map((p) => `<tr>
            <td>${p.id}</td>
            <td>@${esc(p.author.username)}</td>
            <td style="max-width:320px">${esc((p.body || '').slice(0, 140))}</td>
            <td>${p.mediaType !== 'none' ? esc(p.mediaType) : '—'}</td>
            <td>${p.likeCount}</td>
            <td><button class="btn small danger" data-del="${p.id}">Delete</button></td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No posts.</p>';

    $$('[data-del]', panel).forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Delete this post?')) return;
        try {
          await api(`/admin/posts/${b.dataset.del}`, { method: 'DELETE' });
          load($('#ap-search').value);
        } catch (err) { toast('Failed', err.message, 'err'); }
      })
    );
  }

  $('#ap-go').addEventListener('click', () => load($('#ap-search').value));
  await load();
}

async function adminSecurity(panel) {
  panel.innerHTML = '<div class="skeleton"></div>';
  const data = await api('/admin/security');
  const p = data.posture;

  panel.innerHTML = `
    <div class="card">
      <h3>🛡️ Security Studio</h3>
      <p class="muted small">Live security posture for this deployment. Checks run against the current configuration.</p>
      <div class="grid" style="gap:.5rem;margin-top:.7rem">
        ${data.checks.map((c) => `<div class="gps-row">
          <span style="font-size:1.1rem">${c.ok ? '✅' : '⚠️'}</span>
          <div style="flex:1"><strong>${esc(c.label)}</strong>
          <div class="muted small">${esc(c.detail)}</div></div>
          <span class="chip ${c.ok ? 'on' : ''}">${c.ok ? 'pass' : 'action needed'}</span>
        </div>`).join('')}
      </div>
    </div>

    <div class="grid four">
      <div class="stat"><div class="n">${p.totalUsers}</div><div class="l">Accounts</div></div>
      <div class="stat"><div class="n">${p.admins}</div><div class="l">Admins</div></div>
      <div class="stat"><div class="n">${p.usersWithPin}</div><div class="l">With PIN</div></div>
      <div class="stat"><div class="n">${p.banned}</div><div class="l">Suspended</div></div>
    </div>

    <div class="card" style="margin-top:.9rem">
      <h3>Live sessions (${data.sessions.length})</h3>
      ${data.sessions.length
        ? data.sessions.map((s) => `<div class="gps-row" style="margin-bottom:.4rem">
            <span class="dot-online"></span>
            <div style="flex:1"><strong>${esc(s.displayName || s.username || 'unknown')}</strong>
            <div class="muted small">@${esc(s.username || '—')} · ${esc(s.role || 'user')}</div></div>
          </div>`).join('')
        : '<p class="muted">No one is connected right now.</p>'}
    </div>

    <div class="card">
      <h3>Recent security activity</h3>
      ${data.recentActivity.length
        ? `<div class="scroll-x"><table class="table">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead>
            <tbody>${data.recentActivity.map((a) => `<tr>
              <td class="muted small">${timeAgo(a.createdAt)}</td>
              <td>@${esc(a.actor)}</td>
              <td><code>${esc(a.action)}</code></td>
              <td class="small">${esc(a.detail)}</td>
              <td class="muted small">${esc(a.ip || '—')}</td>
            </tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">No security events recorded yet.</p>'}
    </div>

    <div class="card">
      <h3>Hardening links</h3>
      <div class="grid" style="gap:.4rem">
        <div><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create a GitHub token ↗</a>
          <span class="muted small">— needed for the GitHub commit panel</span></div>
        <div><a href="https://app.supabase.com/project/_/settings/api" target="_blank" rel="noopener">Supabase API keys ↗</a>
          <span class="muted small">— SUPABASE_URL and service_role key</span></div>
        <div><a href="https://app.supabase.com/project/_/storage/buckets" target="_blank" rel="noopener">Supabase Storage buckets ↗</a>
          <span class="muted small">— create the media bucket</span></div>
      </div>
    </div>`;
}

async function adminGithub(panel) {
  panel.innerHTML = '<div class="skeleton"></div>';
  let status;
  try {
    status = await api('/admin/github/status');
  } catch (err) {
    status = { configured: false, error: err.message };
  }

  panel.innerHTML = `
    <div class="card">
      <h3>Repository</h3>
      ${status.configured
        ? `<div class="grid two">
             <div><span class="muted small">Repo</span><div><a href="${esc(status.url)}" target="_blank" rel="noopener">${esc(status.repo)}</a></div></div>
             <div><span class="muted small">Branch</span><div>${esc(status.branch)}</div></div>
             <div><span class="muted small">Head commit</span><div><code>${esc((status.headCommit || '').slice(0, 10))}</code></div></div>
             <div><span class="muted small">Last message</span><div class="small">${esc(status.headMessage || '')}</div></div>
           </div>
           <p style="margin-top:.7rem"><a class="btn small" href="${esc(status.url)}" target="_blank" rel="noopener">Open repository ↗</a></p>`
        : `<p class="error">${esc(status.error || status.message || 'Not configured')}</p>
           <p class="muted small">Add <code>GITHUB_TOKEN</code> in the Environment tab (or as an env var) to enable commits from here.</p>
           <p><a class="btn small" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create a GitHub token ↗</a></p>`}
    </div>

    <div class="card">
      <h3>Commit changes</h3>
      <p class="muted small">Edit a file in the repo directly from here. One commit per save.</p>
      <div class="grid" style="gap:.6rem">
        <div class="field"><label>File path</label><input id="gh-path" placeholder="e.g. docs/NOTES.md" /></div>
        <div class="field"><label>Commit message</label><input id="gh-msg" placeholder="chore: update notes" /></div>
        <div class="field"><label>File content</label><textarea id="gh-content" style="min-height:180px;font-family:ui-monospace,monospace" placeholder="File contents…"></textarea></div>
        <div class="row"><button class="btn primary" id="gh-commit">Commit to ${esc(status.branch || 'main')}</button>
          <span class="muted small" id="gh-status"></span></div>
      </div>
    </div>`;

  $('#gh-commit').addEventListener('click', async () => {
    const path = $('#gh-path').value.trim();
    const message = $('#gh-msg').value.trim() || 'chore: update from admin dashboard';
    const content = $('#gh-content').value;
    if (!path) return toast('Path required', '', 'err');
    $('#gh-status').textContent = 'Committing…';
    try {
      const res = await api('/admin/github/commit', {
        method: 'POST',
        body: { message, files: [{ path, content }] },
      });
      $('#gh-status').innerHTML = `Committed <a href="${esc(res.url)}" target="_blank" rel="noopener">${esc(res.commit.slice(0, 10))}</a>`;
      toast('Committed', path, 'ok');
    } catch (err) {
      $('#gh-status').textContent = '';
      toast('Commit failed', err.message, 'err');
    }
  });
}

async function adminSupabase(panel) {
  panel.innerHTML = `
    <div class="card">
      <h3>Supabase Storage</h3>
      <p class="muted small">Used for media uploads (images, video, audio). Without it, files are stored on local disk under <code>/uploads</code>.</p>
      <div class="row"><button class="btn primary" id="sb-test">Test connection</button>
        <span id="sb-result" class="small"></span></div>
      <div class="grid" style="gap:.5rem;margin-top:.9rem">
        <div><span class="muted small">Project URL</span>
          <div><a href="https://app.supabase.com/project/_/settings/api" target="_blank" rel="noopener">Supabase → Settings → Data API ↗</a></div></div>
        <div><span class="muted small">service_role key</span>
          <div><a href="https://app.supabase.com/project/_/settings/api" target="_blank" rel="noopener">Supabase → Settings → API keys ↗</a></div></div>
        <div><span class="muted small">Bucket</span>
          <div><a href="https://app.supabase.com/project/_/storage/buckets" target="_blank" rel="noopener">Supabase → Storage → Buckets ↗</a></div></div>
      </div>
    </div>`;

  $('#sb-test').addEventListener('click', async () => {
    const out = $('#sb-result');
    out.textContent = 'Testing…';
    try {
      const res = await api('/admin/supabase/test', { method: 'POST' });
      out.innerHTML = res.ok
        ? `<span class="ok">Connected. Buckets: ${esc((res.buckets || []).join(', ') || 'none')}${res.bucketConfigured ? ` · target "${esc(res.bucketConfigured)}" ${res.bucketExists ? 'exists' : 'MISSING'}` : ''}</span>`
        : `<span class="error">${esc(res.error)}</span>`;
    } catch (err) {
      out.innerHTML = `<span class="error">${esc(err.message)}</span>`;
    }
  });
}

async function adminEnv(panel) {
  const { env } = await api('/admin/env');
  panel.innerHTML = `
    <div class="card">
      <h3>Environment variables</h3>
      <p class="muted small">Every variable the app reads, whether it is set, and where to get the value.
        Values set as real environment variables win over values saved here.</p>
    </div>
    <div class="card">
      <div class="scroll-x"><table class="table">
        <thead><tr><th>Variable</th><th>Status</th><th>What it is</th><th>Where to get it</th></tr></thead>
        <tbody>
          ${env.map((e) => `<tr>
            <td><code>${esc(e.key)}</code>${e.required ? ' <span class="chip" style="color:var(--warn)">required</span>' : ''}</td>
            <td>${e.configured
              ? `<span class="chip on">set</span><div class="muted small">${esc(e.source)}${e.preview ? ` · ${esc(e.preview)}` : ''}</div>`
              : `<span class="chip">not set</span>${e.default ? `<div class="muted small">default: ${esc(e.default)}</div>` : ''}`}</td>
            <td class="small">${esc(e.what)}</td>
            <td class="small">${esc(e.where)}${e.link ? `<div><a href="${esc(e.link)}" target="_blank" rel="noopener">Open ↗</a></div>` : ''}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </div>
    <div class="card">
      <h3>Save a value</h3>
      <p class="muted small">Stored in the database (secrets are masked in this table). Useful for GITHUB_TOKEN and Supabase keys.</p>
      <div class="grid" style="gap:.6rem;max-width:520px">
        <div class="field"><label>Key</label>
          <select id="env-key">${env.map((e) => `<option value="${esc(e.key)}">${esc(e.key)}</option>`).join('')}</select></div>
        <div class="field"><label>Value</label><input id="env-value" placeholder="paste the value" /></div>
        <button class="btn primary" id="env-save">Save</button>
      </div>
    </div>`;

  $('#env-save').addEventListener('click', async () => {
    const key = $('#env-key').value;
    const value = $('#env-value').value;
    const isSecret = ['JWT_SECRET', 'SUPABASE_SERVICE_KEY', 'GITHUB_TOKEN', 'ADMIN_PIN'].includes(key);
    try {
      await api('/admin/settings', { method: 'PUT', body: { settings: [{ key, value, isSecret }] } });
      toast('Saved', key, 'ok');
      adminEnv(panel);
    } catch (err) {
      toast('Failed', err.message, 'err');
    }
  });
}

async function adminAudit(panel) {
  const { entries } = await api('/admin/audit');
  panel.innerHTML = entries.length
    ? `<div class="card"><div class="scroll-x"><table class="table">
        <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>${entries.map((e) => `<tr>
          <td class="muted small">${timeAgo(e.createdAt)}</td>
          <td>@${esc(e.actor)}</td>
          <td><code>${esc(e.action)}</code></td>
          <td class="small">${esc(e.detail)}</td>
        </tr>`).join('')}</tbody></table></div></div>`
    : '<div class="card"><p class="muted">No audit entries yet.</p></div>';
}

/* ==========================================================================
   WEBRTC CALLS
   ========================================================================== */

const Call = {
  pc: null,
  localStream: null,
  callId: null,
  peer: null,
  pendingCandidates: [],
};

async function startCall(username, kind) {
  try {
    const { call } = await api(`/calls/start/${username}`, { method: 'POST', body: { kind } });
    Call.callId = call.id;
    Call.peer = call.callee;
    showCallOverlay(call, 'Calling…');
    await setupLocalMedia(kind === 'video');
    await createPeerConnection(call.id, true);
  } catch (err) {
    toast('Call failed', err.message, 'err');
  }
}

function showCallOverlay(call, statusText) {
  const overlay = $('#call-overlay');
  overlay.classList.remove('hidden');
  const other = call.caller.id === State.me.id ? call.callee : call.caller;
  $('#call-name').textContent = other.displayName;
  const av = $('#call-avatar');
  if (av) {
    av.outerHTML = avatarHtml(other, '').replace('class="avatar"', 'class="avatar" id="call-avatar"');
  }
  $('#call-status').textContent = statusText;
}

function hideCallOverlay() {
  $('#call-overlay').classList.add('hidden');
  if (Call.localStream) {
    Call.localStream.getTracks().forEach((t) => t.stop());
    Call.localStream = null;
  }
  if (Call.pc) {
    Call.pc.close();
    Call.pc = null;
  }
  Call.callId = null;
  Call.peer = null;
  Call.pendingCandidates = [];
}

async function setupLocalMedia(withVideo) {
  try {
    Call.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    $('#call-local').srcObject = Call.localStream;
  } catch (err) {
    toast('Camera/mic blocked', err.message, 'err');
    throw err;
  }
}

async function createPeerConnection(callId, isCaller) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  Call.pc = pc;

  if (Call.localStream) {
    Call.localStream.getTracks().forEach((t) => pc.addTrack(t, Call.localStream));
  }

  pc.ontrack = (e) => {
    $('#call-remote').srcObject = e.streams[0];
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      window.ChoyRealtime.send({ type: 'call:signal', callId, signal: { candidate: e.candidate } });
    }
  };

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    window.ChoyRealtime.send({ type: 'call:signal', callId, signal: { sdp: pc.localDescription } });
  }
}

async function handleCallSignal(payload) {
  const { callId, signal } = payload;
  if (!Call.pc || Call.callId !== callId) return;

  if (signal.sdp) {
    await Call.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    if (signal.sdp.type === 'offer') {
      const answer = await Call.pc.createAnswer();
      await Call.pc.setLocalDescription(answer);
      window.ChoyRealtime.send({ type: 'call:signal', callId, signal: { sdp: Call.pc.localDescription } });
    }
    for (const c of Call.pendingCandidates) {
      await Call.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    Call.pendingCandidates = [];
  } else if (signal.candidate) {
    if (Call.pc.remoteDescription) {
      await Call.pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
    } else {
      Call.pendingCandidates.push(signal.candidate);
    }
  }
}

function bindCallControls() {
  const hangup = $('#call-hangup');
  if (hangup) {
    hangup.onclick = async () => {
      if (Call.callId) {
        try { await api(`/calls/${Call.callId}/end`, { method: 'POST' }); } catch (_e) { /* ignore */ }
      }
      hideCallOverlay();
    };
  }

  const mute = $('#call-mute');
  if (mute) {
    mute.onclick = (e) => {
      if (!Call.localStream) return;
      const track = Call.localStream.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      e.target.textContent = track.enabled ? '🎙️ Mute' : '🔇 Unmute';
    };
  }

  const cam = $('#call-cam');
  if (cam) {
    cam.onclick = (e) => {
      if (!Call.localStream) return;
      const track = Call.localStream.getVideoTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      e.target.textContent = track.enabled ? '📷 Camera' : '🚫 Camera off';
    };
  }
}

/* ==========================================================================
   REALTIME WIRING
   ========================================================================== */

function bindRealtime() {
  const rt = window.ChoyRealtime;
  if (!rt) return;

  rt.on('status', (status) => {
    const pill = $('#live-pill');
    if (!pill) return;
    pill.className = `pill ${status}`;
    pill.textContent = status === 'live' ? 'Live' : status === 'connecting' ? 'Reconnecting…' : 'Offline';
  });

  rt.on('message:new', (p) => {
    if (State.activeThread && State.activeThread.kind === 'dm' && State.activeThread.id === p.conversationId) {
      const body = $('#thread-body');
      if (body) {
        body.insertAdjacentHTML('beforeend', bubbleHtml(p.message));
        body.scrollTop = body.scrollHeight;
      }
    } else {
      State.unreadMsgs += 1;
      setBadge('#msg-badge', State.unreadMsgs);
      toast('New message', p.sender ? p.sender.displayName : '', '');
    }
  });

  rt.on('message:read', () => {
    if (State.route === 'messages') route();
  });

  rt.on('typing', (p) => {
    const el = $('#typing');
    if (!el) return;
    el.textContent = `${p.username} is typing…`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 2500);
  });

  rt.on('group:typing', (p) => {
    const el = $('#group-typing');
    if (!el) return;
    el.textContent = `${p.username} is typing…`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; }, 2500);
  });

  rt.on('group:message', (p) => {
    if (State.activeThread && State.activeThread.kind === 'group' && State.activeThread.id === p.groupId) {
      const body = $('#group-body');
      if (body) {
        body.insertAdjacentHTML('beforeend', groupBubbleHtml(p.message));
        body.scrollTop = body.scrollHeight;
      }
    } else {
      toast('Group message', p.message.author.displayName, '');
    }
  });

  rt.on('notification:new', (p) => {
    State.unreadNotifs = p.unread;
    setBadge('#notif-badge', p.unread);
    if (p.notification) toast('Notification', p.notification.body, '');
  });

  rt.on('notification:read', (p) => {
    State.unreadNotifs = p.unread;
    setBadge('#notif-badge', p.unread);
  });

  rt.on('notification:clear', () => {
    State.unreadNotifs = 0;
    setBadge('#notif-badge', 0);
  });

  rt.on('post:new', (p) => {
    if (State.route === 'feed') {
      const list = $('#feed-list');
      if (list) {
        const empty = list.querySelector('.empty');
        if (empty) empty.remove();
        list.insertAdjacentHTML('afterbegin', postHtml(p.post));
        bindPostEvents(list);
      }
    }
  });

  rt.on('post:like', (p) => {
    const counter = document.querySelector(`[data-like-count="${p.postId}"]`);
    if (counter) counter.textContent = `${p.likeCount} like${p.likeCount === 1 ? '' : 's'}`;
  });

  rt.on('post:comment', (p) => {
    const counter = document.querySelector(`[data-comment-count="${p.postId}"]`);
    if (counter) counter.textContent = `${p.commentCount} comment${p.commentCount === 1 ? '' : 's'}`;
  });

  rt.on('post:deleted', (p) => {
    const card = document.querySelector(`[data-post="${p.postId}"]`);
    if (card) card.remove();
  });

  rt.on('friend:request', () => {
    State.friendRequests += 1;
    setBadge('#friend-badge', State.friendRequests);
    toast('Friend request', 'Someone wants to connect', '');
  });

  rt.on('friend:accepted', (p) => {
    toast('Friend added', p.user ? p.user.displayName : '', 'ok');
  });

  rt.on('gps:update', () => {
    if (State.route === 'gps' && State.gpsRefresh) State.gpsRefresh();
  });

  rt.on('gps:offline', () => {
    if (State.route === 'gps' && State.gpsRefresh) State.gpsRefresh();
  });

  rt.on('call:incoming', (p) => {
    const call = p.call;
    showCallOverlay(call, 'Incoming call…');
    Call.callId = call.id;
    Call.peer = call.caller;
    const panel = $('.call-actions');
    panel.innerHTML = `
      <button class="btn primary" id="call-accept">Answer</button>
      <button class="btn danger" id="call-decline">Decline</button>`;
    $('#call-accept').addEventListener('click', async () => {
      try {
        await api(`/calls/${call.id}/answer`, { method: 'POST' });
        $('#call-status').textContent = 'Connected';
        await setupLocalMedia(call.kind === 'video');
        await createPeerConnection(call.id, false);
        restoreCallControls();
      } catch (err) {
        toast('Could not answer', err.message, 'err');
        hideCallOverlay();
      }
    });
    $('#call-decline').addEventListener('click', async () => {
      try { await api(`/calls/${call.id}/decline`, { method: 'POST' }); } catch (_e) { /* ignore */ }
      hideCallOverlay();
      restoreCallControls();
    });
  });

  rt.on('call:answered', () => {
    $('#call-status').textContent = 'Connected';
  });

  rt.on('call:signal', (p) => {
    handleCallSignal(p).catch(() => {});
  });

  rt.on('call:declined', () => {
    toast('Call declined', '', '');
    hideCallOverlay();
  });

  rt.on('call:ended', () => {
    toast('Call ended', '', '');
    hideCallOverlay();
  });
}

function restoreCallControls() {
  $('.call-actions').innerHTML = `
    <button class="btn ghost" id="call-mute">🎙️ Mute</button>
    <button class="btn ghost" id="call-cam">📷 Camera</button>
    <button class="btn danger" id="call-hangup">End call</button>`;
  bindCallControls();
}

/* ==========================================================================
   BOOT
   ========================================================================== */

async function boot() {
  showApp();
  try {
    await loadMe();
  } catch (_err) {
    logout();
    return;
  }

  if (window.ChoyRealtime) {
    window.ChoyRealtime.connect(State.token);
  }
  bindRealtime();
  bindCallControls();
  await refreshBadges();
  if (!location.hash) location.hash = '#/feed';
  await route();
}

function bindShell() {
  $$('[data-auth-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      $$('[data-auth-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const isLogin = btn.dataset.authTab === 'login';
      $('#login-form').classList.toggle('hidden', !isLogin);
      $('#register-form').classList.toggle('hidden', isLogin);
      $('#auth-error').classList.add('hidden');
    })
  );

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#auth-error');
    err.classList.add('hidden');
    try {
      await login(e.target.identifier.value, e.target.password.value);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#auth-error');
    err.classList.add('hidden');
    try {
      await register({
        username: e.target.username.value,
        displayName: e.target.displayName.value,
        email: e.target.email.value,
        password: e.target.password.value,
      });
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });

  $('#logout-btn').addEventListener('click', logout);

  $('#nav-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  $('#me-btn').addEventListener('click', () => {
    location.hash = '#/profile';
  });

  $('#notif-btn').addEventListener('click', async () => {
    try {
      const data = await api('/notifications');
      const body = openModal(`
        <div class="modal-head"><h2>Notifications</h2><button class="icon-btn" data-close-modal>✕</button></div>
        ${data.notifications.length
          ? data.notifications.map((n) => `<div class="gps-row" style="margin-bottom:.4rem">
              ${n.actor ? avatarHtml(n.actor, 'sm') : '<span class="avatar sm">🔔</span>'}
              <div style="flex:1"><div class="small">${esc(n.body)}</div>
              <div class="muted small">${timeAgo(n.createdAt)}</div></div>
            </div>`).join('')
          : '<p class="muted">Nothing yet.</p>'}
        <div class="row" style="margin-top:.8rem">
          <button class="btn small" id="notif-read">Mark all read</button>
          <button class="btn small danger" id="notif-clear">Clear all</button>
        </div>`);

      $('#notif-read', body).addEventListener('click', async () => {
        await api('/notifications/read', { method: 'POST' });
        State.unreadNotifs = 0;
        setBadge('#notif-badge', 0);
        closeModal();
      });
      $('#notif-clear', body).addEventListener('click', async () => {
        await api('/notifications', { method: 'DELETE' });
        State.unreadNotifs = 0;
        setBadge('#notif-badge', 0);
        closeModal();
      });
    } catch (err) {
      toast('Failed', err.message, 'err');
    }
  });

  $('#global-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
}

/* ------------------------------------------------------------------- start */

document.addEventListener('DOMContentLoaded', async () => {
  bindShell();
  if (State.token) {
    try {
      await boot();
      return;
    } catch (_err) {
      /* fall through to auth */
    }
  }
  showAuth();
});
