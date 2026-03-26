import { Redirect } from "expo-router";

/** Legacy tab route: all sign-in flows use the stack `auth-landing` screen. */
export default function AuthTabRedirect() {
  return <Redirect href="/auth-landing" />;
}
