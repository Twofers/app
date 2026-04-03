import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: "https://b100f5e0b139ce10a125de7905a8ea19@o4511147983306752.ingest.us.sentry.io/4511147992481792",
  enabled: !__DEV__,
  debug: false,
  tracesSampleRate: 0,
});

export function captureError(
  error: unknown,
  context?: Record<string, string>,
) {
  const err = error instanceof Error ? error : new Error(String(error));
  if (context) {
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}

export { Sentry };
