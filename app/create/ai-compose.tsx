/**
 * Deprecated: AI Compose is now handled by the supported photo route.
 * This compatibility path redirects before painting duplicate UI.
 */
import { Redirect, useLocalSearchParams, type Href } from "expo-router";

export default function AiComposeRedirect() {
  const params = useLocalSearchParams();

  return <Redirect href={{ pathname: "/create/ai", params: params as Record<string, string> } as Href} />;
}
