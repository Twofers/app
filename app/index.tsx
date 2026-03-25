import { Redirect } from "expo-router";

/** Root `/` always lands on main tabs (avoids stale Supabase debug screen). */
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
