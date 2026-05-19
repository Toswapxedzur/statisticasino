import { error } from "@sveltejs/kit";
import { getPost } from "$lib/server/blog.js";

export async function load({ params, locals }) {
  const includeDrafts = !!(locals.user && locals.user.isAdmin);
  const post = getPost(params.slug, { includeDrafts });
  if (!post) throw error(404, "Post not found");
  return { post };
}
