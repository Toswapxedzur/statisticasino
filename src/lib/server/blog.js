// Filesystem-backed blog.
//
// Posts live under `statisticasino/content/blog/*.md`. Each file has
// YAML front matter:
//
//   ---
//   title: "Bet sizing across stake levels"
//   date: 2026-05-10
//   slug: bet-sizing
//   draft: false                                # default false
//   description: "Optional short summary."
//   ---
//   # Markdown body...
//
// The slug defaults to the filename without `.md` if not in the front
// matter. `draft: true` posts are hidden from the index and from
// individual-post lookups (so they return 404 in production).
//
// Caching: we read posts on every request in dev (so live editing
// works); in production, the file list is cached for 60s. That's fast
// enough for ≤100 readers and keeps the cache logic trivial.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
// statisticasino/src/lib/server -> ../../.. -> statisticasino/
const BLOG_DIR = resolve(__dirname, "../../..", "content/blog");

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 60 * 1000;

function listMarkdownFiles() {
  if (!existsSync(BLOG_DIR)) return [];
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(BLOG_DIR, f));
}

function readOne(file) {
  const raw = readFileSync(file, "utf8");
  const parsed = matter(raw);
  const stat = statSync(file);
  const slug = parsed.data.slug
    || file.split("/").pop().replace(/\.md$/, "");
  const date = parsed.data.date
    ? new Date(parsed.data.date).getTime()
    : stat.mtime.getTime();
  return {
    slug,
    title: parsed.data.title || slug,
    description: parsed.data.description || "",
    draft: parsed.data.draft === true,
    date,
    body: parsed.content,
    // `html` is computed lazily by the detail page to avoid parsing
    // every post just to render the index list.
  };
}

export function listPosts({ includeDrafts = false } = {}) {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
    return includeDrafts ? _cache : _cache.filter((p) => !p.draft);
  }
  const posts = listMarkdownFiles()
    .map(readOne)
    .sort((a, b) => b.date - a.date);
  _cache = posts;
  _cacheAt = Date.now();
  return includeDrafts ? posts : posts.filter((p) => !p.draft);
}

export function getPost(slug, { includeDrafts = false } = {}) {
  const all = listPosts({ includeDrafts: true });
  const post = all.find((p) => p.slug === slug);
  if (!post) return null;
  if (post.draft && !includeDrafts) return null;
  return { ...post, html: marked.parse(post.body) };
}

// For admin editor UI later: invalidate the cache when a post changes.
export function invalidateBlogCache() {
  _cache = null;
  _cacheAt = 0;
}
