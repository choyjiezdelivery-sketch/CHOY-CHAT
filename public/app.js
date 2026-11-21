/* CHOY-CHAT — single-page client */
'use strict';

/* ============================ state & helpers ============================ */

const state = {
  token: localStorage.getItem('choy_token') || null,
  me: null,
  route: 'home',
  params: {},
  feedMode: 'all',
  notifUnread: 0,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z')).getTime();
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function avatar(user, size = '') {
  const color = (user && user.avatarColor) || '#6c5ce7';
  const name = (user && (user.displayName || user.username)) || '?';
  return `<span class="avatar ${size}" style="background:${esc(color)}">${esc(initials(name))}</span>`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch (_e) {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ============================ auth ============================ */

function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const btn = $('#me-avatar');
  btn.style.background = state.me.avatarColor;
  btn.textContent = initials(state.me.displayName);
  btn.onclick = () => navigate(`/u/${state.me.username}`);
}

function setSession(token, user) {
  state.token = token;
  state.me = user;
  localStorage.setItem('choy_token', token);
  showApp();
  refreshNotifBadge();
  navigate(location.hash.slice(1) || '/home');
}

function logout() {
  state.token = null;
  state.me = null;
  localStorage.removeItem('choy_token');
  location.hash = '';
  showAuth();
}

$('#auth-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-auth-tab]');
  if (!tab) return;
  $$('#auth-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
  const isLogin = tab.dataset.authTab === 'login';
  $('#login-form').classList.toggle('hidden', !isLogin);
  $('#register-form').classList.toggle('hidden', isLogin);
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const errEl = $('[data-error]', form);
  errEl.textContent = '';
  const fd = new FormData(form);
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: fd.get('identifier'),
        password: fd.get('password'),
      }),
    });
    setSession(data.token, data.user);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const errEl = $('[data-error]', form);
  errEl.textContent = '';
  const fd = new FormData(form);
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        displayName: fd.get('displayName'),
        email: fd.get('email'),
        password: fd.get('password'),
      }),
    });
    setSession(data.token, data.user);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', logout);

/* ============================ routing ============================ */

function navigate(path) {
  if (location.hash.slice(1) === path) render();
  else location.hash = path;
}

function parseRoute() {
  const raw = location.hash.slice(1) || '/home';
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const params = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((v, k) => {
      params[k] = v;
    });
  }
  return { segs, params };
}

window.addEventListener('hashchange', render);

/* ============================ post rendering ============================ */

function postCard(post, opts = {}) {
  const mine = state.me && post.author.id === state.me.id;
  return `
    <article class="post" data-post-id="${post.id}">
      <div class="post-head">
        <a href="#/u/${esc(post.author.username)}">${avatar(post.author)}</a>
        <a class="post-meta" href="#/u/${esc(post.author.username)}">
          <span class="name">${esc(post.author.displayName)}</span>
          <span class="handle">@${esc(post.author.username)}</span>
        </a>
        <span class="post-time">${esc(timeAgo(post.createdAt))}</span>
      </div>
      <div class="post-body" data-open-post="${post.id}">${esc(post.body)}</div>
      <div class="post-actions">
        <button class="act ${post.liked ? 'liked' : ''}" data-like="${post.id}">
          ${post.liked ? '❤️' : '🤍'} <span data-like-count>${post.likeCount}</span>
        </button>
        <button class="act" data-open-post="${post.id}">💬 ${post.commentCount}</button>
        <button class="act ${post.bookmarked ? 'saved' : ''}" data-bookmark="${post.id}">
          ${post.bookmarked ? '🔖' : '📑'}
        </button>
        ${mine ? `<button class="act danger" data-delete-post="${post.id}">🗑</button>` : ''}
      </div>
    </article>`;
}

function bindPostActions(root) {
  root.addEventListener('click', async (e) => {
    const likeBtn = e.target.closest('[data-like]');
    if (likeBtn) {
      const id = likeBtn.dataset.like;
      const liked = likeBtn.classList.contains('liked');
      try {
        const data = await api(`/posts/${id}/like`, { method: liked ? 'DELETE' : 'POST' });
        likeBtn.classList.toggle('liked', data.liked);
        likeBtn.innerHTML = `${data.liked ? '❤️' : '🤍'} <span data-like-count>${data.likeCount}</span>`;
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    const bmBtn = e.target.closest('[data-bookmark]');
    if (bmBtn) {
      const id = bmBtn.dataset.bookmark;
      const saved = bmBtn.classList.contains('saved');
      try {
        await api(`/posts/${id}/bookmark`, { method: saved ? 'DELETE' : 'POST' });
        bmBtn.classList.toggle('saved', !saved);
        bmBtn.textContent = !saved ? '🔖' : '📑';
        toast(!saved ? 'Saved to bookmarks' : 'Removed from bookmarks');
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    const delBtn = e.target.closest('[data-delete-post]');
    if (delBtn) {
      if (!confirm('Delete this post?')) return;
      try {
        await api(`/posts/${delBtn.dataset.deletePost}`, { method: 'DELETE' });
        toast('Post deleted');
        render();
      } catch (err) {
        toast(err.message);
      }
      return;
    }

    const openBtn = e.target.closest('[data-open-post]');
    if (openBtn) openPostModal(openBtn.dataset.openPost);
  });
}

/* ============================ post modal ============================ */

async function openPostModal(id) {
  const modal = $('#post-modal');
  const body = $('#post-modal-body');
  body.innerHTML = '<div class="skeleton"></div>';
  modal.classList.remove('hidden');
  try {
    const [{ post }, { comments }] = await Promise.all([
      api(`/posts/${id}`),
      api(`/posts/${id}/comments`),
    ]);
    body.innerHTML = `
      ${postCard(post)}
      <div class="card" style="margin-top:14px">
        <h3 class="card-title">Comments (${comments.length})</h3>
        <div id="comment-list">
          ${
            comments.length
              ? comments
                  .map(
                    (c) => `
            <div class="comment">
              ${avatar(c.author, 'sm')}
              <div class="grow">
                <b>${esc(c.author.displayName)}</b>
                <span class="handle" style="color:var(--muted);font-size:12px">@${esc(c.author.username)} · ${esc(timeAgo(c.createdAt))}</span>
                <p>${esc(c.body)}</p>
              </div>
            </div>`
                  )
                  .join('')
              : '<p class="empty">No comments yet. Be the first.</p>'
          }
        </div>
        <form id="comment-form" class="thread-form" style="margin-top:12px">
          <input name="body" maxlength="300" placeholder="Write a comment…" required />
          <button class="btn btn-primary" type="submit">Send</button>
        </form>
      </div>`;
    bindPostActions(body);

    $('#comment-form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.currentTarget.querySelector('input');
      try {
        await api(`/posts/${id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: input.value }),
        });
        openPostModal(id);
        toast('Comment added');
      } catch (err) {
        toast(err.message);
      }
    });
  } catch (err) {
    body.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

$$('[data-close-modal]').forEach((btn) =>
  btn.addEventListener('click', () => btn.closest('.modal').classList.add('hidden'))
);
$$('.modal').forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  })
);

/* ============================ composer ============================ */

function composerMarkup() {
  return `
    <div class="card">
      <form class="composer-inline" id="inline-composer">
        <textarea name="body" maxlength="500" placeholder="What's happening, ${esc(
          state.me.displayName
        )}?" required></textarea>
        <div class="composer-foot">
          <span class="counter" data-counter>0 / 500</span>
          <button class="btn btn-primary" type="submit">Post</button>
        </div>
      </form>
    </div>`;
}

function bindComposer(root) {
  const form = $('#inline-composer', root);
  if (!form) return;
  const ta = form.querySelector('textarea');
  const counter = $('[data-counter]', form);
  ta.addEventListener('input', () => {
    counter.textContent = `${ta.value.length} / 500`;
    counter.classList.toggle('over', ta.value.length > 500);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/posts', { method: 'POST', body: JSON.stringify({ body: ta.value }) });
      ta.value = '';
      counter.textContent = '0 / 500';
      toast('Posted!');
      render();
    } catch (err) {
      toast(err.message);
    }
  });
}

$('#compose-btn').addEventListener('click', () => {
  $('#composer-modal').classList.remove('hidden');
  $('#composer-form textarea').focus();
});

$('#composer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const ta = form.querySelector('textarea');
  try {
    await api('/posts', { method: 'POST', body: JSON.stringify({ body: ta.value }) });
    ta.value = '';
    $('#composer-counter').textContent = '0 / 500';
    $('#composer-modal').classList.add('hidden');
    toast('Posted!');
    render();
  } catch (err) {
    $('[data-error]', form).textContent = err.message;
  }
});

$('#composer-form textarea').addEventListener('input', (e) => {
  $('#composer-counter').textContent = `${e.target.value.length} / 500`;
});

/* ============================ pages ============================ */

async function pageHome(main) {
  main.innerHTML = `
    ${composerMarkup()}
    <div class="section-head">
      <h2 class="page-title">Timeline</h2>
      <div class="tabs" style="margin:0;width:auto">
        <button class="tab ${state.feedMode === 'all' ? 'active' : ''}" data-feed="all">Everyone</button>
        <button class="tab ${state.feedMode === 'following' ? 'active' : ''}" data-feed="following">Following</button>
      </div>
    </div>
    <div id="feed"><div class="skeleton"></div><div class="skeleton" style="margin-top:12px"></div></div>`;

  bindComposer(main);
  $$('[data-feed]', main).forEach((btn) =>
    btn.addEventListener('click', () => {
      state.feedMode = btn.dataset.feed;
      render();
    })
  );

  try {
    const { posts } = await api(`/posts?feed=${state.feedMode}&limit=30`);
    const feed = $('#feed', main);
    feed.innerHTML = posts.length
      ? posts.map((p) => postCard(p)).join('')
      : `<div class="card empty">${
          state.feedMode === 'following'
            ? 'Your following feed is empty. Follow some people from Explore.'
            : 'No posts yet. Be the first to post!'
        }</div>`;
    bindPostActions(feed);
  } catch (err) {
    $('#feed', main).innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

async function pageExplore(main) {
  main.innerHTML = `
    <h2 class="page-title">Explore</h2>
    <div class="card">
      <h3 class="card-title">Trending posts</h3>
      <div id="trending"><div class="skeleton"></div></div>
    </div>
    <div class="card">
      <h3 class="card-title">People to follow</h3>
      <div id="suggested"><div class="skeleton"></div></div>
    </div>`;

  try {
    const [{ posts }, { users }] = await Promise.all([
      api('/search/trending'),
      api('/users/suggested'),
    ]);
    $('#trending', main).innerHTML = posts.length
      ? posts.map((p) => postCard({ ...p, liked: false, bookmarked: false, commentCount: 0 })).join('')
      : '<p class="empty">Nothing trending yet.</p>';
    bindPostActions($('#trending', main));

    $('#suggested', main).innerHTML = users.length
      ? users.map((u) => userRow(u)).join('')
      : '<p class="empty">You already follow everyone here.</p>';
    bindFollowButtons($('#suggested', main));
  } catch (err) {
    main.innerHTML += `<div class="card empty">${esc(err.message)}</div>`;
  }
}

function userRow(u) {
  return `
    <div class="user-row" data-user="${esc(u.username)}">
      <a href="#/u/${esc(u.username)}">${avatar(u, 'sm')}</a>
      <a class="grow" href="#/u/${esc(u.username)}">
        <b>${esc(u.displayName)}</b>
        <small>@${esc(u.username)}${u.bio ? ' · ' + esc(u.bio.slice(0, 40)) : ''}</small>
      </a>
      ${
        state.me && u.id !== state.me.id
          ? `<button class="btn btn-sm ${u.isFollowing ? '' : 'btn-primary'}" data-follow="${esc(
              u.username
            )}" data-following="${u.isFollowing ? '1' : '0'}">${u.isFollowing ? 'Following' : 'Follow'}</button>`
          : ''
      }
    </div>`;
}

function bindFollowButtons(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-follow]');
    if (!btn) return;
    const username = btn.dataset.follow;
    const following = btn.dataset.following === '1';
    try {
      const data = await api(`/users/${username}/follow`, { method: following ? 'DELETE' : 'POST' });
      btn.dataset.following = data.following ? '1' : '0';
      btn.textContent = data.following ? 'Following' : 'Follow';
      btn.classList.toggle('btn-primary', !data.following);
    } catch (err) {
      toast(err.message);
    }
  });
}

async function pageProfile(main, username) {
  main.innerHTML = '<div class="skeleton" style="height:180px"></div>';
  try {
    const { user } = await api(`/users/${encodeURIComponent(username)}`);
    const { posts } = await api(`/posts?username=${encodeURIComponent(username)}&limit=30`);
    main.innerHTML = `
      <div class="card profile-head">
        <div class="profile-top">
          ${avatar(user, 'lg')}
          <div class="profile-id">
            <h1>${esc(user.displayName)}</h1>
            <span class="handle">@${esc(user.username)}</span>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px">
            ${
              user.isSelf
                ? '<a class="btn btn-sm" href="#/settings">Edit profile</a>'
                : `<button class="btn btn-sm ${user.isFollowing ? '' : 'btn-primary'}" data-follow="${esc(
                    user.username
                  )}" data-following="${user.isFollowing ? '1' : '0'}">${
                    user.isFollowing ? 'Following' : 'Follow'
                  }</button>
                   <button class="btn btn-sm" data-message="${esc(user.username)}">Message</button>`
            }
          </div>
        </div>
        ${user.bio ? `<p class="profile-bio">${esc(user.bio)}</p>` : ''}
        <div class="profile-meta">
          ${user.location ? `<span>📍 ${esc(user.location)}</span>` : ''}
          ${user.website ? `<span>🔗 ${esc(user.website)}</span>` : ''}
          <span>Joined ${esc(new Date(user.createdAt + 'Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</span>
        </div>
        <div class="stats">
          <div class="stat"><b>${user.posts}</b><span>Posts</span></div>
          <div class="stat"><b>${user.followers}</b><span>Followers</span></div>
          <div class="stat"><b>${user.following}</b><span>Following</span></div>
        </div>
      </div>
      <h2 class="page-title">Posts</h2>
      <div id="profile-posts">
        ${
          posts.length
            ? posts.map((p) => postCard(p)).join('')
            : '<div class="card empty">No posts yet.</div>'
        }
      </div>`;

    bindFollowButtons(main);
    bindPostActions($('#profile-posts', main));

    const msgBtn = $('[data-message]', main);
    if (msgBtn) {
      msgBtn.addEventListener('click', async () => {
        try {
          const { conversationId } = await api(`/messages/open/${msgBtn.dataset.message}`, {
            method: 'POST',
          });
          navigate(`/messages/${conversationId}`);
        } catch (err) {
          toast(err.message);
        }
      });
    }
  } catch (err) {
    main.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

async function pageNotifications(main) {
  main.innerHTML = `
    <div class="section-head">
      <h2 class="page-title">Notifications</h2>
      <button class="btn btn-sm" id="clear-notifs">Clear all</button>
    </div>
    <div class="card" id="notif-list"><div class="skeleton"></div></div>`;

  try {
    const { notifications } = await api('/notifications');
    $('#notif-list', main).innerHTML = notifications.length
      ? notifications
          .map(
            (n) => `
        <div class="notif ${n.isRead ? '' : 'unread'}">
          ${n.actor ? avatar(n.actor, 'sm') : '<span class="avatar sm" style="background:#444">🔔</span>'}
          <div class="grow">
            <div class="notif-body">${esc(n.body)}</div>
            <div class="notif-time">${esc(timeAgo(n.createdAt))}</div>
          </div>
        </div>`
          )
          .join('')
      : '<p class="empty">No notifications yet.</p>';

    await api('/notifications/read', { method: 'POST' });
    state.notifUnread = 0;
    updateNotifBadge();
  } catch (err) {
    $('#notif-list', main).innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }

  $('#clear-notifs', main).addEventListener('click', async () => {
    if (!confirm('Clear all notifications?')) return;
    await api('/notifications', { method: 'DELETE' });
    render();
  });
}

async function pageMessages(main, conversationId) {
  main.innerHTML = `
    <h2 class="page-title">Messages</h2>
    <div class="msg-layout">
      <div class="card conv-list" id="conv-list"><div class="skeleton"></div></div>
      <div class="card" id="thread"><p class="empty">Select a conversation</p></div>
    </div>`;

  let conversations = [];
  try {
    const data = await api('/messages');
    conversations = data.conversations;
    $('#conv-list', main).innerHTML = conversations.length
      ? conversations
          .map(
            (c) => `
        <button class="conv ${String(c.id) === String(conversationId) ? 'active' : ''}" data-conv="${c.id}">
          ${avatar(c.user, 'sm')}
          <span class="grow">
            <b>${esc(c.user ? c.user.displayName : 'Unknown')}</b>
            <small>${esc(c.lastMessage ? c.lastMessage.body : 'No messages yet')}</small>
          </span>
          ${c.unread ? `<span class="badge" style="position:static">${c.unread}</span>` : ''}
        </button>`
          )
          .join('')
      : '<p class="empty">No conversations yet. Open someone\'s profile and hit Message.</p>';

    $$('[data-conv]', main).forEach((btn) =>
      btn.addEventListener('click', () => navigate(`/messages/${btn.dataset.conv}`))
    );
  } catch (err) {
    $('#conv-list', main).innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }

  if (!conversationId) return;

  try {
    const data = await api(`/messages/${conversationId}`);
    const thread = $('#thread', main);
    thread.innerHTML = `
      <div class="thread">
        <div class="thread-head">
          ${avatar(data.user, 'sm')}
          <a href="#/u/${esc(data.user.username)}"><b>${esc(data.user.displayName)}</b></a>
        </div>
        <div class="bubbles" id="bubbles">
          ${
            data.messages.length
              ? data.messages
                  .map(
                    (m) => `
            <div>
              <div class="bubble ${m.mine ? 'mine' : ''}">${esc(m.body)}</div>
              <div class="bubble-time" style="text-align:${m.mine ? 'right' : 'left'}">${esc(
                      timeAgo(m.createdAt)
                    )}</div>
            </div>`
                  )
                  .join('')
              : '<p class="empty">Say hello 👋</p>'
          }
        </div>
        <form class="thread-form" id="msg-form">
          <input name="body" maxlength="1000" placeholder="Write a message…" required autocomplete="off" />
          <button class="btn btn-primary" type="submit">Send</button>
        </form>
      </div>`;

    const bubbles = $('#bubbles', thread);
    bubbles.scrollTop = bubbles.scrollHeight;

    $('#msg-form', thread).addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.currentTarget.querySelector('input');
      try {
        await api(`/messages/${conversationId}`, {
          method: 'POST',
          body: JSON.stringify({ body: input.value }),
        });
        input.value = '';
        pageMessages(main, conversationId);
      } catch (err) {
        toast(err.message);
      }
    });
  } catch (err) {
    $('#thread', main).innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

async function pageBookmarks(main) {
  main.innerHTML = '<h2 class="page-title">Bookmarks</h2><div id="bm"><div class="skeleton"></div></div>';
  try {
    const { posts } = await api('/posts/bookmarks');
    $('#bm', main).innerHTML = posts.length
      ? posts.map((p) => postCard(p)).join('')
      : '<div class="card empty">No bookmarks yet. Tap 📑 on a post to save it.</div>';
    bindPostActions($('#bm', main));
  } catch (err) {
    $('#bm', main).innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

async function pageSettings(main) {
  main.innerHTML = '<div class="skeleton" style="height:260px"></div>';
  try {
    const { user } = await api('/auth/me');
    main.innerHTML = `
      <h2 class="page-title">Settings</h2>
      <div class="card">
        <h3 class="card-title">Profile</h3>
        <form id="profile-form" class="auth-form">
          <label>Display name <input name="displayName" value="${esc(user.displayName)}" maxlength="50" /></label>
          <label>Bio <textarea name="bio" maxlength="200" rows="3">${esc(user.bio)}</textarea></label>
          <label>Location <input name="location" value="${esc(user.location)}" maxlength="60" /></label>
          <label>Website <input name="website" value="${esc(user.website)}" maxlength="120" /></label>
          <label>Avatar color <input name="avatarColor" type="color" value="${esc(user.avatarColor)}" style="height:44px;padding:4px" /></label>
          <button class="btn btn-primary" type="submit">Save profile</button>
          <p class="form-error" data-error></p>
        </form>
      </div>
      <div class="card">
        <h3 class="card-title">Change password</h3>
        <form id="password-form" class="auth-form">
          <label>Current password <input name="currentPassword" type="password" required /></label>
          <label>New password <input name="newPassword" type="password" minlength="8" required /></label>
          <button class="btn" type="submit">Update password</button>
          <p class="form-error" data-error></p>
        </form>
      </div>
      <div class="card">
        <h3 class="card-title">Account</h3>
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 12px">
          Signed in as <b>@${esc(user.username)}</b>
        </p>
        <button class="btn btn-danger" id="signout-settings">Sign out</button>
      </div>`;

    $('#profile-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        const data = await api('/users/me', {
          method: 'PATCH',
          body: JSON.stringify({
            displayName: fd.get('displayName'),
            bio: fd.get('bio'),
            location: fd.get('location'),
            website: fd.get('website'),
            avatarColor: fd.get('avatarColor'),
          }),
        });
        state.me = { ...state.me, ...data.user };
        showApp();
        toast('Profile updated');
      } catch (err) {
        $('[data-error]', e.currentTarget).textContent = err.message;
      }
    });

    $('#password-form', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await api('/users/me/password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: fd.get('currentPassword'),
            newPassword: fd.get('newPassword'),
          }),
        });
        e.currentTarget.reset();
        toast('Password updated');
      } catch (err) {
        $('[data-error]', e.currentTarget).textContent = err.message;
      }
    });

    $('#signout-settings', main).addEventListener('click', logout);
  } catch (err) {
    main.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

async function pageSearch(main, q) {
  main.innerHTML = `
    <h2 class="page-title">Results for “${esc(q)}”</h2>
    <div class="card"><h3 class="card-title">People</h3><div id="s-users"><div class="skeleton"></div></div></div>
    <div class="card"><h3 class="card-title">Posts</h3><div id="s-posts"><div class="skeleton"></div></div></div>`;
  try {
    const data = await api(`/search?q=${encodeURIComponent(q)}`);
    $('#s-users', main).innerHTML = data.users.length
      ? data.users.map((u) => userRow({ ...u, isFollowing: false })).join('')
      : '<p class="empty">No people found.</p>';
    bindFollowButtons($('#s-users', main));

    $('#s-posts', main).innerHTML = data.posts.length
      ? data.posts
          .map((p) =>
            postCard({
              ...p,
              likeCount: 0,
              commentCount: 0,
              liked: false,
              bookmarked: false,
              author: { ...p.author, id: 0 },
            })
          )
          .join('')
      : '<p class="empty">No posts found.</p>';
    bindPostActions($('#s-posts', main));
  } catch (err) {
    main.innerHTML += `<div class="card empty">${esc(err.message)}</div>`;
  }
}

/* ============================ rail ============================ */

async function renderRail() {
  const rail = $('#rail');
  rail.innerHTML = `
    <div class="card">
      <h3 class="card-title">Who to follow</h3>
      <div id="rail-users"><div class="skeleton" style="height:60px"></div></div>
    </div>
    <div class="card">
      <h3 class="card-title">About</h3>
      <p style="color:var(--muted);font-size:13px;margin:0">
        CHOY-CHAT is an open-source social app — feed, follows, likes, comments,
        bookmarks, notifications and direct messages.
      </p>
    </div>`;
  try {
    const { users } = await api('/users/suggested');
    $('#rail-users', rail).innerHTML = users.length
      ? users.map((u) => userRow(u)).join('')
      : '<p class="empty" style="padding:12px 0">All caught up.</p>';
    bindFollowButtons($('#rail-users', rail));
  } catch (_err) {
    $('#rail-users', rail).innerHTML = '';
  }
}

/* ============================ notifications badge ============================ */

function updateNotifBadge() {
  const badge = $('#notif-badge');
  if (!badge) return;
  if (state.notifUnread > 0) {
    badge.textContent = state.notifUnread > 9 ? '9+' : String(state.notifUnread);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function refreshNotifBadge() {
  if (!state.token) return;
  try {
    const { unread } = await api('/notifications');
    state.notifUnread = unread;
    updateNotifBadge();
  } catch (_err) {
    /* ignore */
  }
}

/* ============================ render ============================ */

async function render() {
  if (!state.token) return showAuth();

  const { segs, params } = parseRoute();
  const main = $('#main');
  const route = segs[0] || 'home';

  $$('.nav-item[data-nav]').forEach((el) =>
    el.classList.toggle('active', el.dataset.nav === route)
  );
  $('#sidebar').classList.remove('open');

  if (route === 'home') await pageHome(main);
  else if (route === 'explore') await pageExplore(main);
  else if (route === 'notifications') await pageNotifications(main);
  else if (route === 'messages') await pageMessages(main, segs[1]);
  else if (route === 'bookmarks') await pageBookmarks(main);
  else if (route === 'settings') await pageSettings(main);
  else if (route === 'search') await pageSearch(main, params.q || '');
  else if (route === 'u' && segs[1]) await pageProfile(main, segs[1]);
  else await pageHome(main);

  renderRail();
  refreshNotifBadge();
}

/* ============================ global wiring ============================ */

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
});

$('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $$('.modal').forEach((m) => m.classList.add('hidden'));
    $('#sidebar').classList.remove('open');
  }
});

/* ============================ boot ============================ */

(async function boot() {
  if (!state.token) return showAuth();
  try {
    const { user } = await api('/auth/me');
    state.me = user;
    showApp();
    render();
  } catch (_err) {
    logout();
  }
})();
