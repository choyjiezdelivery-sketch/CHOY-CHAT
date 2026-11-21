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
- **Tests** — 27 end-to-end API tests

## Next up

### Phase 2 — Media and richer posts
- Image uploads (the `image_url` column and `multer` dependency are already in place)
- Multi-image posts and a lightbox viewer
- Post editing with an "edited" marker
- Link previews

### Phase 3 — Real-time
- WebSocket (or SSE) delivery for messages and notifications, so the badge and threads update live
- Typing indicators and read receipts
- Online / last-seen presence

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

## Known limitations

- The database is a single SQLite file — fine for a small instance, not for horizontal scaling.
- No rate limiting yet, so the auth endpoints are open to brute-force attempts.
- Messages and notifications are polled, not pushed.
- No image upload endpoint yet, even though the schema supports an image URL.
