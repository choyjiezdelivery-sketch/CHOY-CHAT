/**
 * In-memory data store.
 *
 * Deliberately simple: the scaffold keeps everything in process memory so the
 * API can be exercised without a database. Replace this module with real
 * persistence (Postgres, SQLite, Mongo...) when the data model settles.
 */

let userSeq = 0;
let postSeq = 0;

const users = new Map(); // handle -> user
const posts = new Map(); // id -> post

function nextUserId() {
  userSeq += 1;
  return `u_${userSeq}`;
}

function nextPostId() {
  postSeq += 1;
  return `p_${postSeq}`;
}

export const store = {
  // ---- users -------------------------------------------------------------
  listUsers() {
    return [...users.values()];
  },

  getUser(handle) {
    return users.get(String(handle).toLowerCase()) ?? null;
  },

  createUser({ handle, displayName, bio = '' }) {
    const key = String(handle).toLowerCase();
    if (users.has(key)) {
      const err = new Error(`Handle "${handle}" is already taken`);
      err.status = 409;
      throw err;
    }
    const user = {
      id: nextUserId(),
      handle: key,
      displayName: displayName || handle,
      bio,
      followers: [],
      following: [],
      createdAt: new Date().toISOString(),
    };
    users.set(key, user);
    return user;
  },

  // ---- posts -------------------------------------------------------------
  listPosts() {
    return [...posts.values()].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
  },

  getPost(id) {
    return posts.get(id) ?? null;
  },

  createPost({ author, body }) {
    const post = {
      id: nextPostId(),
      author,
      body,
      likes: [],
      comments: [],
      createdAt: new Date().toISOString(),
    };
    posts.set(post.id, post);
    return post;
  },

  likePost(id, handle) {
    const post = posts.get(id);
    if (!post) return null;
    if (!post.likes.includes(handle)) post.likes.push(handle);
    return post;
  },

  deletePost(id) {
    return posts.delete(id);
  },
};
