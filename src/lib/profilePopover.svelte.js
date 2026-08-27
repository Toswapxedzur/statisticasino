// A single app-wide profile popover: any avatar can open it with a user id and an
// anchor rect. One <ProfilePopover> is mounted in the root layout and renders it.
class ProfilePopover {
  userId = $state(null);
  rect = $state(null);

  open(userId, rect) {
    if (!userId) return;
    // Toggle off if the same avatar is clicked again.
    if (this.userId === userId) { this.close(); return; }
    this.userId = userId;
    this.rect = rect || null;
  }
  close() { this.userId = null; this.rect = null; }
}

export const profilePop = new ProfilePopover();
