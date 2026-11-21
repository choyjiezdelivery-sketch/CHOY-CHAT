import { Router } from 'express';

import { store } from '../store.js';

const router = Router();

// GET /api/posts — newest first
router.get('/', (_req, res) => {
  res.json({ posts: store.listPosts() });
});

// POST /api/posts — create a post
router.post('/', (req, res) => {
  const { author, body } = req.body ?? {};
  if (!author || !body) {
    return res.status(400).json({ error: '`author` and `body` are required' });
  }
  const post = store.createPost({ author, body });
  res.status(201).json({ post });
});

// POST /api/posts/:id/like — like a post
router.post('/:id/like', (req, res) => {
  const { handle } = req.body ?? {};
  if (!handle) return res.status(400).json({ error: '`handle` is required' });
  const post = store.likePost(req.params.id, handle);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post });
});

// DELETE /api/posts/:id — remove a post
router.delete('/:id', (req, res) => {
  const removed = store.deletePost(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Post not found' });
  res.status(204).end();
});

export default router;
