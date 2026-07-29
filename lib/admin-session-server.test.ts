import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const originalKey = process.env.ADMIN_SESSION_ENCRYPTION_KEY;
const testKey = Buffer.alloc(32, 7).toString("base64url");

type ResponseStub = {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
};

function responseStub(): ResponseStub {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

function requestWithCookie(setCookie: string) {
  return {
    headers: {
      cookie: setCookie.split(";")[0],
      host: "admin.twoferapp.com",
      origin: "https://admin.twoferapp.com",
      "x-forwarded-proto": "https",
    },
  };
}

describe("sealed admin server session", () => {
  let sessions: typeof import("../website/server/admin-session.js");

  beforeAll(() => {
    process.env.ADMIN_SESSION_ENCRYPTION_KEY = testKey;
    sessions = require("../website/server/admin-session.js");
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.ADMIN_SESSION_ENCRYPTION_KEY;
    else process.env.ADMIN_SESSION_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips an authenticated session in a host-only hardened cookie", async () => {
    const state = sessions.sessionState({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
    });
    const response = responseStub();
    sessions.setState(response, state);

    const setCookie = response.headers["Set-Cookie"];
    expect(setCookie).toContain("__Host-twofer_admin_session=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Domain=");

    const restored = await sessions.activeState(requestWithCookie(setCookie), responseStub());
    expect(restored?.session.access_token).toBe("access");
    expect(restored?.absolute_expires_at - restored?.issued_at).toBe(8 * 60 * 60 * 1000);
  });

  it("rejects a tampered sealed cookie", () => {
    const state = sessions.sessionState({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
    });
    const response = responseStub();
    sessions.setState(response, state);
    const setCookie = response.headers["Set-Cookie"];
    const cookiePair = setCookie.split(";")[0];
    const tampered = `${cookiePair.slice(0, -1)}${cookiePair.endsWith("A") ? "B" : "A"}`;

    expect(sessions.readState({ headers: { cookie: tampered } })).toBeNull();
  });

  it("requires an exact same-origin mutation request", () => {
    expect(sessions.sameOrigin(requestWithCookie("x=y"))).toBe(true);
    expect(sessions.sameOrigin({
      headers: {
        host: "admin.twoferapp.com",
        origin: "https://attacker.example",
        "x-forwarded-proto": "https",
      },
    })).toBe(false);
    expect(sessions.sameOrigin({ headers: { host: "admin.twoferapp.com" } })).toBe(false);
  });
});
