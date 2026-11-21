# Contributing to CHOY-CHAT

Thanks for helping out. A few ground rules keep the project easy to work with.

## Getting set up

```bash
git clone https://github.com/choyjiezdelivery-sketch/CHOY-CHAT.git
cd CHOY-CHAT
npm install
cp .env.example .env
npm run dev
```

## Workflow

1. Branch off `main` with a descriptive name:
   - `feature/direct-messages`
   - `fix/duplicate-likes`
   - `docs/api-examples`
2. Keep commits small and focused. Write the message in the imperative mood:
   - `feat: add follow endpoint`
   - `fix: reject empty post body`
   - `docs: document the posts API`
3. Open a pull request against `main` and describe what changed and why.

## Code style

- ES modules (`import` / `export`), Node.js 20+
- Two-space indentation, semicolons, single quotes
- Prefer small functions with clear names over comments explaining clever code
- No new dependency without a reason in the pull request description

## Reporting bugs

Open an issue with:

- what you did
- what you expected
- what actually happened
- your Node version and operating system

## License

By contributing you agree that your work is released under the [MIT License](LICENSE).
