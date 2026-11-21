**Demo accounts** (after `npm run seed`, password `password123`): `choy`, `maya`, `nico`, `lea`

### Scripts

| Command | Does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with auto-restart on file change |
| `npm run seed` | Insert demo users, posts, follows and likes |
| `npm test` | Run the DOM contract check, then the full test suite (45 tests: 27 API + 18 realtime, in-memory database) |
| `npm run check:dom` | Verify every element id `app.js` looks up exists in the shell or a template |

---

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | dev fallback | **Set this in production** |
| `DATABASE_PATH` | `data/choy.db` | SQLite file location |
| `UPLOAD_DIR` | `uploads` | Where media files are written |
| `MAX_UPLOAD_MB` | `25` | Per-file upload limit |
| `CORS_ORIGIN` | `*` | Allowed origin for the API |

---

## API

All routes are under `/api`. Authenticated routes need `Authorization: Bearer <token>`.

### Auth

| Method | Path | Does |
|---|---|---|
| `POST` | `/auth/register` | Create an account, returns `{ token, user }` |
| `POST` | `/auth/login` | Sign in by username **or** email |
| `GET` | `/auth/me` | Current user |

### Users

| Method | Path | Does |
|---|---|---|
| `GET` | `/users/me` | My profile |
| `PATCH` | `/users/me` | Update display name, bio, location, website, avatar, cover |
| `POST` | `/users/me/password` | Change password |
| `GET` | `/users/:username` | Public profile with counts and relationship state |
| `GET` | `/users/:username/posts` | That user's posts |
| `POST` | `/users/:username/follow` | Follow |
| `DELETE` | `/users/:username/follow` | Unfollow |

### Posts

| Method | Path | Does |
|---|---|---|
| `GET` | `/posts?feed=all\|following&limit=&offset=` | Timeline |
| `POST` | `/posts` | Create a post (text and/or media) |
| `DELETE` | `/posts/:id` | Delete your own post |
| `POST` | `/posts/:id/like` | Like (idempotent) |
| `DELETE` | `/posts/:id/like` | Unlike |
| `GET` | `/posts/:id/comments` | List comments |
| `POST` | `/posts/:id/comments` | Add a comment |
| `POST` | `/posts/:id/bookmark` | Save |
| `DELETE` | `/posts/:id/bookmark` | Unsave |
| `GET` | `/bookmarks` | My saved posts |

### Messages

| Method | Path | Does |
|---|---|---|
| `GET` | `/messages` | Conversation list with unread counts |
| `POST` | `/messages/open/:username` | Open (or create) a conversation |
| `GET` | `/messages/:conversationId` | Thread messages |
| `POST` | `/messages/:conversationId` | Send a message |
| `POST` | `/messages/:conversationId/read` | Mark read |

### Other

| Method | Path | Does |
|---|---|---|
| `GET` | `/notifications` | List with unread count |
| `POST` | `/notifications/read` | Mark all read |
| `GET` | `/search?q=` | Search users and posts |
| `POST` | `/media/upload` | Multipart upload, returns `{ url, mediaType }` |
| `GET` | `/health` | Liveness probe |

---

## Realtime

The client opens `ws://<host>/ws?token=<jwt>`. Events are JSON `{ type, ...payload }`.

**Client → server:** `ping`, `typing`, `read`

**Server → client:** `hello`, `presence`, `message:new`, `message:read`, `typing`, `notification:new`, `notification:read`, `post:new`, `post:like`, `post:comment`, `post:deleted`, `follow:new`

---

## Security notes

- Passwords are hashed with bcrypt; tokens are signed JWTs.
- Every mutating route checks ownership before acting.
- Conversation access is verified on read and write — a third party cannot open someone else's thread.
- The front end escapes all user content before rendering, so post bodies cannot inject HTML.

**Before deploying:** set a strong `JWT_SECRET`, serve over HTTPS, and add rate limiting on `/auth/*`.

---

## Testing

```bash
npm test
```

**45 tests, all passing.**

`npm test` first runs `scripts/check-dom.js`, a static contract check: every `$('#id')` in `public/app.js` must exist either in `public/index.html` or in a template string `app.js` injects. This exists because the UI once broke silently — `app.js` referenced `#auth-error`, the old `index.html` had no such element, and the login submit handler threw before it ever called the API, so signing in did nothing with no visible error. The check now fails the build instead.

`tests/api.test.js` (27) covers registration and validation, login by username and email, auth guards, post creation and deletion permissions, like idempotency, comments, bookmarks, follow/unfollow, the following feed, search, direct messages, conversation access control, profile updates and password changes.

`tests/realtime.test.js` (18) opens real WebSocket clients against a live server and asserts that: unauthenticated and bad-token sockets are rejected; `hello` carries the online list; a DM reaches the recipient and **not** a third party; sending also pushes a notification; reading a thread notifies the sender; typing is relayed; `ping` is answered; a new post is broadcast; a like and a comment each push to the author; a follow pushes to the target; presence is announced; deleting a post broadcasts; marking read pushes `notification:read`; and the hub releases connections on disconnect.

---

## License

MIT — see [LICENSE](LICENSE).
