// Sections hidden from everyone but the site owner (admin): the casino.org
// data tooling (/data, /contribute) and the blog. Non-owners get a 404 so the
// pages are indistinguishable from nonexistent ones. The code stays for the
// owner's own use.
import { error } from "@sveltejs/kit";

export function ownerOnly(locals) {
  if (!locals?.user?.isAdmin) throw error(404, "Not found");
}
