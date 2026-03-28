/**
 * Dev-only logging. All calls are no-ops in production builds.
 * Use instead of bare console.log / console.warn in client code.
 */

function noop(..._args: unknown[]) {}

export const devLog: (...args: unknown[]) => void =
  typeof __DEV__ !== "undefined" && __DEV__ ? console.log.bind(console) : noop;

export const devWarn: (...args: unknown[]) => void =
  typeof __DEV__ !== "undefined" && __DEV__ ? console.warn.bind(console) : noop;

export const devError: (...args: unknown[]) => void =
  typeof __DEV__ !== "undefined" && __DEV__ ? console.error.bind(console) : noop;
