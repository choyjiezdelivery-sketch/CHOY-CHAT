# CHOY-CHAT Roadmap

Where the app is now, and what would come next.

## Shipped (v1.0)

- **Accounts** — register, sign in with username or email, JWT sessions, bcrypt password hashing, change password
- **Profiles** — display name, bio, location, website, avatar colour, follower/following/post counts, edit profile
- **Posts** — create, delete your own, global timeline, "Following" feed, post detail modal
- **Engagement** — likes, comments, bookmarks
- **Social graph** — follow / unfollow, followers and following lists, suggestions
- **Notifications** — follow, like, comment and message events; unread badge; mark read; clear
- **Direct messages** — conversation list, unread counts, message threads
- **Discovery** — search people and posts, trending by likes, explore page
- **UI** — dark theme, responsive layout with mobile drawer nav
- **Tests** — 45 end-to-end tests (27 REST + 18 realtime)

## Shipped (v1.1) — Real-time

- **WebSocket hub** (`src/realtime.js`) on the same port as the REST API, authenticated with the same JWT
- **Live messages** — a DM appears in an open thread instantly, with a toast when you are elsewhere
- **Live notifications** — badge count and notification list update without a refresh
- **Live timeline** — new posts prepend to the feed; like and comment counts update in place; deletions remove the card
- **Presence** — online dot per thread, driven by connect/disconnect events
- **Typing indicators** — relayed between the two participants of a conversation
- **Read receipts** — your own bubbles get a ✓✓ once the other side opens the thread
- **Resilience** — 30s server heartbeat, client auto-reconnect with backoff, and a Live / Reconnecting / Offline pill in the top bar

## Next up

### Phase 2 — Media and richer posts
- Image uploads (the `image_url` column and `multer` dependency are already in place)
- Multi-image posts and a lightbox viewer
- Post editing with an "edited" marker
- Link previews

### Phase 4 — Scale and safety
- Rate limiting on `/auth/*` and write endpoints
- Refresh tokens and session revocation
- Report / block / mute
- Content moderation hooks
- Full-text search (SQLite FTS5) instead of `LIKE`
- Pagination on every list endpoint

### Phase 5 — Platform
- Dockerfile and one-command deploy
- Postgres migration path (the data layer is already isolated in `src/db.js`)
- Push notifications for mobile
- Public API keys for third-party clients

### Phase 6 — Realtime hardening
- Durable delivery: queue events for offline users and replay on reconnect
- Redis pub/sub so the hub works across multiple server instances
- Group conversations (the schema is currently one-to-one)
- Message editing, deletion and attachments
- Last-seen timestamps alongside the online dot

## Known limitations

- The database is a single SQLite file — fine for a small instance, not for horizontal scaling.
- No rate limiting yet, so the auth endpoints are open to brute-force attempts.
- Realtime delivery is best-effort: events fired while a client is offline are not replayed.
- The WebSocket hub keeps its registry in process memory, so it does not scale horizontally
  without a shared pub/sub layer.
- No image upload endpoint yet, even though the schema supports an image URL.
