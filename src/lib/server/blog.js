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
//   pinned: false                               # default false
//   description: "Optional short summary."
//   ---
//   # Markdown body...
//
// The slug defaults to the filename without `.md` if not in the front
// matter. `draft: true` posts are hidden from the index and from
// individual-post lookups (so they return 404 in production).
// `pinned: true` posts are sorted above non-pinned posts in the index
// (still ordered by date desc within each bucket).
//
// Caching: we read posts on every request in dev (so live editing
// works); in production, the file list is cached for 60s. That's fast
// enough for ≤100 readers and keeps the cache logic trivial.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";

// Server-side LaTeX rendering for stat-heavy posts. `$..$` becomes
// inline math and `$$..$$` becomes display math (block-level). The
// extension calls `katex.renderToString` and substitutes the produced
// HTML into the marked output, so no client-side JS is required;
// readers only need the KaTeX CSS shipped via app.css to see the
// glyphs aligned correctly. `throwOnError: false` keeps a malformed
// equation from crashing the page render — the offending source is
// shown in red instead.
marked.use(markedKatex({
  throwOnError: false,
  output: "html",
  // Permissive `$..$` matching: allow inline math adjacent to parens,
  // hyphens, em-dashes etc. Statistical prose frequently has things like
  // `($8.19 \cdot 1.340^2$)` and `$0.20$–$0.35$`, both of which the
  // standard rule rejects because the surrounding character is not in
  // the strict delimiter set.
  nonStandard: true
}));

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
    pinned: parsed.data.pinned === true,
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
    .sort((a, b) => {
      // Pinned posts float to the top; within each bucket, newest first.
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.date - a.date;
    });
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
