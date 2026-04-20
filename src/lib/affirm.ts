import { affirmPublicKey } from "@/lib/env";
import type { AffirmConfig } from "@/types/affirm";

/**
 * Sandbox CDN URL per Affirm's docs. When the project moves to prod we flip
 * this to https://cdn1.affirm.com/js/v2/affirm.js (the same-named file on the
 * non-sandbox CDN).
 */
const AFFIRM_SCRIPT_URL = "https://cdn1-sandbox.affirm.com/js/v2/affirm.js";

let loadStarted = false;

/**
 * Inject the Affirm bootstrap IIFE exactly once per iframe. The IIFE itself
 * is copied verbatim from Affirm's "Set up promotional messaging" guide —
 * it installs a queueing proxy on `window.affirm` and appends a <script> tag
 * that fetches the real SDK. Subsequent calls are no-ops.
 *
 * See: https://docs.affirm.com/developers/docs/set-up-promotional-messaging
 */
export function loadAffirmSdk(): void {
  if (typeof window === "undefined") return;
  if (loadStarted) return;
  if (window.affirm?.ui?.refresh) {
    loadStarted = true;
    return;
  }

  const config: AffirmConfig = {
    public_api_key: affirmPublicKey,
    script: AFFIRM_SCRIPT_URL,
    locale: "en_US",
    country_code: "USA",
  };
  window._affirm_config = config;

  // The block below is the vendor-supplied bootstrap. We keep the variable
  // names minimal and the logic untouched so future SDK updates from Affirm
  // can drop in as-is.
  (function bootstrap(
    w: Window & typeof globalThis,
    g: AffirmConfig,
    n: "affirm",
    d: "checkout",
    a: "ui",
    e: "script",
    h: "ready",
    c: "jsReady"
  ): void {
    type Queue = { _: unknown[] };
    type MethodStub = ((...args: unknown[]) => void) & Queue;
    type Host = {
      [k: string]: unknown;
      _?: unknown[];
      [d]?: MethodStub;
      [a]?: { [h]?: (...args: unknown[]) => void; _?: unknown[] };
      [c]?: (...args: unknown[]) => void;
    };

    const win = w as unknown as Record<string, Host>;
    const host: Host = win[n] ?? {};
    const scriptEl = document.createElement(e);
    const sibling = document.getElementsByTagName(e)[0];

    const queuer =
      (h0: Host, k0: keyof Host, label: string) =>
      (...rest: unknown[]): void => {
        const target = h0[k0] as Queue | undefined;
        if (target && Array.isArray(target._)) {
          target._.push([label, rest]);
        }
      };

    host[d] = queuer(host, d, "set") as MethodStub;
    host[d]!._ = [];
    const methodHost = host[d] as MethodStub;

    host[a] = { _: [] };
    host._ = [];

    host[a]![h] = queuer(host, a, h);
    host[c] = (...rest: unknown[]): void => {
      host._!.push([h, rest]);
    };

    const setMethods = [
      "set",
      "add",
      "save",
      "post",
      "open",
      "empty",
      "reset",
      "on",
      "off",
      "trigger",
      "ready",
      "setProduct",
    ] as const;
    for (const method of setMethods) {
      (methodHost as unknown as Record<string, unknown>)[method] = queuer(
        host,
        d,
        method
      );
    }
    const noopMethods = ["get", "token", "url", "items"] as const;
    for (const method of noopMethods) {
      (methodHost as unknown as Record<string, unknown>)[method] = () =>
        undefined;
    }

    scriptEl.async = true;
    (scriptEl as HTMLScriptElement).src = g[e as "script"];
    sibling?.parentNode?.insertBefore(scriptEl, sibling);
    delete (g as unknown as Record<string, unknown>)[e];
    methodHost(g as unknown as never);
    win[n] = host;
  })(window, config, "affirm", "checkout", "ui", "script", "ready", "jsReady");

  loadStarted = true;
}

/**
 * Tell the SDK to rescan the DOM and re-render every `.affirm-as-low-as`
 * element against its current `data-amount`. Safe to call before the SDK
 * has fully loaded — `refresh` is optional on the proxy that the bootstrap
 * IIFE installs, so we optional-call it and let the SDK do its initial
 * render automatically when the CDN script finishes downloading.
 */
export function refreshAffirmUi(): void {
  if (typeof window === "undefined") return;
  window.affirm?.ui?.refresh?.();
}
