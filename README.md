# CHOY-CHAT

> A social media app — connect, share, and chat.

CHOY-CHAT is a social platform where people create a profile, post updates, follow each other, and chat in real time. This repository holds the starter scaffold: a small Node.js/Express API plus a dependency-free web client.

---

## Status

**Early scaffold.** The structure, tooling and API surface are in place; features are stubs backed by an in-memory store. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what is planned.

## Features (planned)

- **Accounts** — sign up, sign in, profile with avatar and bio
- **Posts** — text and image posts, likes, comments
- **Feed** — chronological and ranked timelines
- **Follow graph** — follow / unfollow, followers and following lists
- **Chat** — direct messages between users
- **Notifications** — likes, comments, follows, mentions

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ |
| API | Express 4 |
| Client | Vanilla HTML / CSS / JS (no build step) |
| Data | In-memory store (swap for a database later) |

## Getting started

```bash
# 1. Clone
git clone https://github.com/choyjiezdelivery-sketch/CHOY-CHAT.git
cd CHOY-CHAT

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Run
npm run dev     # auto-restarts on file changes
# or
npm start
```

The API listens on `http://localhost:3000` and serves the web client from the same origin.

## Project structure

```
CHOY-CHAT/
├── public/              # Web client (served statically)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── server.js        # Express app entry point
│   ├── store.js         # In-memory data store
│   └── routes/
│       ├── users.js     # /api/users
│       └── posts.js     # /api/posts
├── docs/
│   └── ROADMAP.md
├── .env.example
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
└── package.json
```

## API reference

Base URL: `/api`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health check |
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Create a user (`{ handle, displayName }`) |
| `GET` | `/api/users/:handle` | Get one user by handle |
| `GET` | `/api/posts` | List posts, newest first |
| `POST` | `/api/posts` | Create a post (`{ author, body }`) |
| `POST` | `/api/posts/:id/like` | Like a post |
| `DELETE` | `/api/posts/:id` | Delete a post |

### Example

```bash
curl -X POST http://localhost:3000/api/posts \
  -H 'Content-Type: application/json' \
  -d '{"author":"choy","body":"First post!"}'
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: branch off `main`, keep commits focused, open a pull request.

## License

[MIT](LICENSE)
