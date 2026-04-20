import { describe, expect, it } from "vitest";

import { parseRefererHostname } from "@/lib/referer";

describe("parseRefererHostname", () => {
  it("returns the hostname for a standard https URL", () => {
    expect(parseRefererHostname("https://shop.example.com/page")).toBe(
      "shop.example.com"
    );
  });

  it("returns the hostname for a standard http URL", () => {
    expect(parseRefererHostname("http://shop.example.com")).toBe(
      "shop.example.com"
    );
  });

  it("strips the port and returns only the hostname for localhost:3000", () => {
    expect(parseRefererHostname("http://localhost:3000")).toBe("localhost");
  });

  it("strips the port and returns only the hostname for a non-standard https port", () => {
    expect(parseRefererHostname("https://example.com:8443/path")).toBe(
      "example.com"
    );
  });

  it("returns the IP address string for an IP-based URL", () => {
    expect(parseRefererHostname("https://192.168.1.1/path")).toBe(
      "192.168.1.1"
    );
  });

  it("lowercases the hostname", () => {
    expect(parseRefererHostname("https://SHOP.EXAMPLE.COM/")).toBe(
      "shop.example.com"
    );
  });

  it("returns null for an unparseable string", () => {
    expect(parseRefererHostname("not a url")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseRefererHostname("")).toBeNull();
  });

  it("returns null when the input is null", () => {
    expect(parseRefererHostname(null)).toBeNull();
  });

  it("returns null for about:blank — parses but produces an empty hostname", () => {
    expect(parseRefererHostname("about:blank")).toBeNull();
  });

  it("returns null for a data: URL — parses but produces an empty hostname", () => {
    expect(parseRefererHostname("data:text/html,<h1>hi</h1>")).toBeNull();
  });

  it("returns null for a file:// URL — parses but produces an empty hostname", () => {
    expect(parseRefererHostname("file:///etc/hosts")).toBeNull();
  });
});
