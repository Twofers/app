import { describe, expect, it } from "vitest";

import { validateWebsiteImportUrl } from "./website-import-security";

describe("website import URL security", () => {
  it("normalizes merchant domains to https by default", () => {
    expect(validateWebsiteImportUrl(" cedarbean.example/menu#photos ")).toMatchObject({
      ok: true,
      url: "https://cedarbean.example/menu",
      origin: "https://cedarbean.example",
      hostname: "cedarbean.example",
    });
  });

  it("allows standard http and https ports only", () => {
    expect(validateWebsiteImportUrl("http://example.com:80")).toMatchObject({ ok: true });
    expect(validateWebsiteImportUrl("https://example.com:443")).toMatchObject({ ok: true });
    expect(validateWebsiteImportUrl("https://example.com:8443")).toEqual({
      ok: false,
      reason: "UNSUPPORTED_PORT",
    });
  });

  it("rejects unsupported protocols and embedded credentials", () => {
    expect(validateWebsiteImportUrl("file:///etc/passwd")).toEqual({
      ok: false,
      reason: "UNSUPPORTED_PROTOCOL",
    });
    expect(validateWebsiteImportUrl("https://user:pass@example.com")).toEqual({
      ok: false,
      reason: "CREDENTIALS_NOT_ALLOWED",
    });
  });

  it("blocks localhost-style hostnames", () => {
    expect(validateWebsiteImportUrl("http://localhost")).toEqual({
      ok: false,
      reason: "LOCAL_HOST_BLOCKED",
    });
    expect(validateWebsiteImportUrl("http://dev.local")).toEqual({
      ok: false,
      reason: "LOCAL_HOST_BLOCKED",
    });
    expect(validateWebsiteImportUrl("http://printer.home.arpa")).toEqual({
      ok: false,
      reason: "LOCAL_HOST_BLOCKED",
    });
  });

  it("blocks private and local IPv4 targets", () => {
    for (const url of [
      "http://127.0.0.1",
      "http://10.0.0.5",
      "http://172.16.1.2",
      "http://192.168.1.2",
      "http://169.254.169.254",
      "http://100.64.0.1",
      "http://224.0.0.1",
    ]) {
      expect(validateWebsiteImportUrl(url)).toEqual({ ok: false, reason: "PRIVATE_IP_BLOCKED" });
    }
  });

  it("blocks private and local IPv6 targets", () => {
    expect(validateWebsiteImportUrl("http://[::1]")).toEqual({
      ok: false,
      reason: "PRIVATE_IP_BLOCKED",
    });
    expect(validateWebsiteImportUrl("http://[fd00::1]")).toEqual({
      ok: false,
      reason: "PRIVATE_IP_BLOCKED",
    });
    expect(validateWebsiteImportUrl("http://[fe80::1]")).toEqual({
      ok: false,
      reason: "PRIVATE_IP_BLOCKED",
    });
    expect(validateWebsiteImportUrl("http://[::ffff:192.168.1.2]")).toEqual({
      ok: false,
      reason: "PRIVATE_IP_BLOCKED",
    });
  });
});
