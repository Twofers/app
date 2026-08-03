/**
 * Marks a sign-out the user asked for, so AuthStackGate can tell it apart from a
 * session that simply went away (expired refresh token, banned account, deep link
 * opened while signed out).
 *
 * Why this exists: `router.replace` queues its action and the queue is flushed on
 * the next commit, so the render that observes `session === null` still reports the
 * screen the user was signing out from. AuthStackGate ran on that render and queued
 * its own `/auth-landing?next=/(tabs)/settings` redirect *after* the sign-out's plain
 * `/auth-landing` — the later action won, and the next login replayed `next` and
 * dropped the user back on Settings instead of Home.
 *
 * Module-level state (not React state) on purpose: the flag has to be readable from
 * the gate's effect during that same commit, before any re-render could deliver it.
 */
let userInitiatedSignOutPending = false;

/** Call synchronously before clearing the Supabase session. */
export function markUserInitiatedSignOut(): void {
  userInitiatedSignOutPending = true;
}

/** Call once the sign-out finished routing, failed, or a new session exists. */
export function clearUserInitiatedSignOut(): void {
  userInitiatedSignOutPending = false;
}

export function isUserInitiatedSignOutPending(): boolean {
  return userInitiatedSignOutPending;
}
