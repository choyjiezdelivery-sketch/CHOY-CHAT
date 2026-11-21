# CHOY-CHAT 💬

A full-stack social media app — share posts, follow people, like and comment, bookmark, get notified, and chat one-on-one.

Built with **Node.js + Express + SQLite** on the back end and a **dependency-free vanilla JS single-page app** on the front end. No build step, no bundler — clone it and run it.

---

## Features

| Area | What works |
|---|---|
| **Accounts** | Register, sign in with username *or* email, JWT sessions, bcrypt-hashed passwords, change password |
| **Profiles** | Display name, bio, location, website, avatar colour, follower/following/post counts, edit profile |
| **Posts** | Create (500-char limit), delete your own, timeline of everyone, "Following" feed, post detail view |
| **Engagement** | Like / unlike, comment (300-char limit), delete your own comments, bookmark / unbookmark |
| **Social graph** | Follow / unfollow, followers & following lists, "who to follow" suggestions |
| **Notifications** | Generated on follow, like, comment and new message; unread badge, mark-all-read, clear all |
| **Direct messages** | Open a conversation from any profile, conversation list with unread counts, message thread, send |
| **Realtime** | WebSocket push for messages, notifications, likes, comments, follows and new posts — no polling, no refresh |
| **Presence & typing** | Live online indicator per thread, "is typing…" relay, read receipts on your own bubbles |
| **Discovery** | Search people and posts, trending posts by like count, explore page |
| **UI** | Dark theme, responsive (mobile drawer nav), toast feedback, modals, empty states, live connection pill |

---

## Quick start

```bash
git clone https://github.com/choyjiezdelivery-sketch/CHOY-CHAT.git
cd CHOY-CHAT
npm install
cp .env.example .env      # optional — sensible defaults are built in
npm run seed              # optional — creates demo users and posts
npm start
```

Open <http://localhost:3000>.

**Demo accounts** (after `npm run seed`, password `password123`): `choy`, `maya`, `nico`, `lea`

### Scripts

| Command | Does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with auto-restart on file change |
| `npm run seed` | Insert demo users, posts, follows and likes |
| `npm test` | Run the full test suite (45 tests: 27 API + 18 realtime, in-memory database) |

---

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | dev fallback | **Set this in production** |
| `DB_PATH` | `data/choy-chat.db` | SQLite file; use `:memory:` for tests |

---

## Project structure

```
CHOY-CHAT/
├── public/                 # front end (served statically)
│   ├── index.html          # app shell + auth screen
│   ├── styles.css          # dark theme, responsive
│   ├── realtime.js         # WebSocket client (auto-reconnect, event bus)
│   └── app.js              # SPA: router, pages, API client, live handlers
├── src/
│   ├── server.js           # Express app + HTTP server shared with the WS hub
│   ├── db.js               # SQLite connection + schema
│   ├── auth.js             # JWT signing, auth middleware, user shaping
│   ├── realtime.js         # WebSocket hub: auth, registry, emit/broadcast
│   ├── notify.js           # notification insert + live push in one call
│   ├── seed.js             # demo data
│   └── routes/
│       ├── auth.js         # register / login / me
│       ├── users.js        # profiles, follow, followers, settings
│       ├── posts.js        # posts, likes, comments, bookmarks
│       ├── notifications.js
│       ├── messages.js     # conversations + direct messages
│       └── search.js       # search + trending
├── tests/
│   ├── api.test.js         # end-to-end REST tests
│   └── realtime.test.js    # WebSocket delivery tests
└── docs/ROADMAP.md         # what's next
```

---

## API reference

All endpoints are under `/api`. Authenticated routes need `Authorization: Bearer <token>`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | `{username, email, password, displayName?}` → `{token, user}` |
| `POST` | `/auth/login` | — | `{identifier, password}` (username or email) → `{token, user}` |
| `GET` | `/auth/me` | ✅ | Current user |

### Users

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/users?q=&limit=` | — | List / search users |
| `GET` | `/users/suggested` | ✅ | People you don't follow yet |
| `GET` | `/users/:username` | — | Profile with counts and `isFollowing` |
| `PATCH` | `/users/me` | ✅ | Update displayName, bio, location, website, avatarColor |
| `POST` | `/users/me/password` | ✅ | `{currentPassword, newPassword}` |
| `POST` | `/users/:username/follow` | ✅ | Follow |
| `DELETE` | `/users/:username/follow` | ✅ | Unfollow |
| `GET` | `/users/:username/followers` | — | Follower list |
| `GET` | `/users/:username/following` | — | Following list |

### Posts

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/posts?feed=all\|following&username=&limit=&before=` | — | Timeline / user posts (cursor pagination) |
| `GET` | `/posts/search?q=` | — | Search post bodies |
| `GET` | `/posts/bookmarks` | ✅ | Your bookmarked posts |
| `GET` | `/posts/:id` | — | Single post |
| `POST` | `/posts` | ✅ | `{body, imageUrl?}` |
| `DELETE` | `/posts/:id` | ✅ | Delete your own post |
| `POST` / `DELETE` | `/posts/:id/like` | ✅ | Like / unlike |
| `POST` / `DELETE` | `/posts/:id/bookmark` | ✅ | Bookmark / unbookmark |
| `GET` | `/posts/:id/comments` | — | Comments |
| `POST` | `/posts/:id/comments` | ✅ | `{body}` |
| `DELETE` | `/posts/:postId/comments/:commentId` | ✅ | Delete your own comment |

### Notifications

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/notifications` | ✅ | List + unread count |
| `POST` | `/notifications/read` | ✅ | Mark all read |
| `DELETE` | `/notifications` | ✅ | Clear all |

### Messages

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/messages` | ✅ | Conversation list with last message + unread |
| `POST` | `/messages/open/:username` | ✅ | Open (or create) a conversation → `{conversationId}` |
| `GET` | `/messages/:conversationId` | ✅ | Thread (marks incoming as read) |
| `POST` | `/messages/:conversationId` | ✅ | `{body}` |

### Search

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/search?q=` | — | Users + posts in one call |
| `GET` | `/search/trending` | — | Top posts by like count |

### Misc

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness check, including live realtime connection counts |

---

## Realtime (WebSocket)

Every signed-in client opens one WebSocket to `ws://<host>/ws`. The REST API and the
socket share the same port and the same JWT, so there is nothing extra to configure.

### Connecting

Browsers cannot set headers on a WebSocket handshake, so the token is passed as a query
parameter (a `Bearer` header and a `bearer.<token>` subprotocol are also accepted for
non-browser clients):

```js
const ws = new WebSocket(`ws://localhost:3000/ws?token=${encodeURIComponent(token)}`);
```

A socket without a valid token is rejected during the handshake with `401`.

### Wire format

Every frame in both directions is JSON:

```json
{ "event": "message:new", "payload": { "...": "..." }, "at": "2026-11-21T11:36:36.637Z" }
```

### Server → client events

| Event | Payload | Fired when |
|---|---|---|
| `hello` | `{userId, username, online[]}` | You connect |
| `presence` | `{userId, username, online}` | Someone connects or disconnects |
| `message:new` | `{conversationId, message, sender}` | A DM arrives for you |
| `message:read` | `{conversationId, readerId}` | The other side opened the thread |
| `typing` | `{conversationId, userId, username}` | The other side is typing |
| `notification:new` | `{notification, unread}` | Any notification is created for you |
| `notification:read` | `{unread}` | Your notifications were marked read |
| `notification:clear` | `{unread}` | Your notifications were cleared |
| `post:new` | `{post}` | Someone posted (everyone except the author) |
| `post:like` | `{postId, likeCount, likedBy}` | Someone liked your post |
| `post:comment` | `{postId, commentCount, comment}` | Someone commented on your post |
| `post:deleted` | `{postId}` | A post was deleted |
| `follow:new` | `{follower, counts}` | Someone followed you |
| `pong` | `{at}` | Reply to your `ping` |
| `error` | `{error}` | Malformed frame or unknown event type |

### Client → server events

| Type | Payload | Effect |
|---|---|---|
| `ping` | — | Server replies `pong` (keeps intermediaries from idling the socket out) |
| `typing` | `{conversationId}` | Relayed to the other participant as `typing` |

### Delivery guarantees

- Events go **only** to the people entitled to them: a DM reaches the recipient, a like
  reaches the post author, and a third party receives nothing. This is covered by tests.
- Notifications are written to SQLite and pushed in the same call (`src/notify.js`), so the
  REST list and the live socket can never disagree.
- The server pings every client every 30s and drops sockets that stop answering.
- The client reconnects automatically with exponential backoff (1s → 15s) and shows the
  state in the top-bar pill: **Live**, **Reconnecting…** or **Offline**.
- Delivery is best-effort, not durable: a client that is offline when an event fires will
  not receive it on reconnect. The REST endpoints remain the source of truth, so a page
  load or refresh always shows the current state.

---

## Data model

```
users ──┬── posts ──┬── likes
        │           ├── comments
        │           └── bookmarks
        ├── follows (follower_id → followee_id)
        ├── notifications (user_id, actor_id, post_id)
        └── conversations (user_a, user_b) ── messages
```

SQLite with foreign keys and `ON DELETE CASCADE`, so deleting a user or post cleans up its likes, comments, bookmarks and notifications.

---

## Security notes

- Passwords are hashed with **bcrypt** (cost 10) and never returned by any endpoint.
- Sessions are **JWTs** (7-day expiry) sent as a bearer token.
- Every write endpoint checks ownership: you can only delete your own posts and comments, and only read conversations you belong to.
- Input is validated server-side (username format, email format, password length, body length limits).
- The front end escapes all user content before rendering, so post bodies cannot inject HTML.

**Before deploying:** set a strong `JWT_SECRET`, serve over HTTPS, and add rate limiting on `/auth/*`.

---

## Testing

```bash
npm test
```

**45 tests, all passing.**

`tests/api.test.js` (27) covers registration and validation, login by username and email, auth guards, post creation and deletion permissions, like idempotency, comments, bookmarks, follow/unfollow, the following feed, search, direct messages, conversation access control, profile updates and password changes.

`tests/realtime.test.js` (18) opens real WebSocket clients against a live server and asserts that: unauthenticated and bad-token sockets are rejected; `hello` carries the online list; a DM reaches the recipient and **not** a third party; sending also pushes a notification; reading a thread notifies the sender; typing is relayed; `ping` is answered; a new post is broadcast; a like and a comment each push to the author; a follow pushes to the target; presence is announced; deleting a post broadcasts; marking read pushes `notification:read`; and the hub releases connections on disconnect.

---

## License

MIT — see [LICENSE](LICENSE).
