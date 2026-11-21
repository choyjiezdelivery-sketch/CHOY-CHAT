import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';

import postsRouter from './routes/posts.js';
import usersRouter from './routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- API -------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'choy-chat', time: new Date().toISOString() });
});

app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);

// --- Web client ------------------------------------------------------------
app.use(express.static(publicDir));

// --- 404 + error handling --------------------------------------------------
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`CHOY-CHAT running on http://localhost:${PORT}`);
});

export default app;
