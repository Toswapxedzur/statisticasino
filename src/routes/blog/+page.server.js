import { listPosts } from "$lib/server/blog.js";

export async function load({ locals }) {
  // Admins see drafts in the listing.
  const includeDrafts = !!(locals.user && locals.user.isAdmin);
  const posts = listPosts({ includeDrafts });
  return {
    posts: posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      draft: p.draft,
      date: p.date
    }))
  };
}
