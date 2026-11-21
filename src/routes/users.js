import { Router } from 'express';

import { store } from '../store.js';

const router = Router();

// GET /api/users — list every user
router.get('/', (_req, res) => {
  res.json({ users: store.listUsers() });
});

// POST /api/users — create a user
router.post('/', (req, res, next) => {
  try {
    const { handle, displayName, bio } = req.body ?? {};
    if (!handle || typeof handle !== 'string') {
      return res.status(400).json({ error: '`handle` is required' });
    }
    const user = store.createUser({ handle, displayName, bio });
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/:handle — fetch one user
router.get('/:handle', (req, res) => {
  const user = store.getUser(req.params.handle);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

export default router;
