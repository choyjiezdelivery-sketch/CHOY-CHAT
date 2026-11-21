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
| **Discovery** | Search people and posts, trending posts by like count, explore page |
| **UI** | Dark theme, responsive (mobile drawer nav), toast feedback, modals, empty states |

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
| `npm test` | Run the API test suite (27 tests, in-memory database) |

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
│   └── app.js              # SPA: router, pages, API client
├── src/
│   ├── server.js           # Express app, middleware, route mounting
│   ├── db.js               # SQLite connection + schema
│   ├── auth.js             # JWT signing, auth middleware, user shaping
│   ├── seed.js             # demo data
│   └── routes/
│       ├── auth.js         # register / login / me
│       ├── users.js        # profiles, follow, followers, settings
│       ├── posts.js        # posts, likes, comments, bookmarks
│       ├── notifications.js
│       ├── messages.js     # conversations + direct messages
│       └── search.js       # search + trending
├── tests/api.test.js       # end-to-end API tests
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
| `GET` | `/api/health` | Liveness check |

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

27 end-to-end tests cover registration and validation, login by username and email, auth guards, post creation and deletion permissions, like idempotency, comments, bookmarks, follow/unfollow, the following feed, search, direct messages, conversation access control, profile updates and password changes.

---

## License

MIT — see [LICENSE](LICENSE).
