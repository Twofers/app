let claimed = false;
export function claimInitialUrl(): boolean {
  if (claimed) return false;
  claimed = true;
  return true;
}
