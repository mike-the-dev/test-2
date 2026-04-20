/**
 * Minimal type surface for Affirm's promotional-messaging SDK.
 *
 * The CDN script populates `window.affirm` with the full API; we only type
 * the slice we actually call (`ui.refresh`). The `_affirm_config` variable
 * is consumed by the SDK's bootstrap IIFE — the SDK deletes it after load,
 * so it's modelled as optional here.
 */

export interface AffirmConfig {
  public_api_key: string;
  script: string;
  locale: string;
  country_code: string;
}

export interface AffirmSdk {
  ui?: {
    /**
     * Optional at the type level because the bootstrap IIFE installs a queue
     * proxy on `window.affirm.ui` that exposes only `ready` — `refresh` only
     * appears once the real CDN script has loaded and replaced the proxy.
     * Consumers must call it via `?.()` to stay safe during that window.
     */
    refresh?: () => void;
  };
}

declare global {
  interface Window {
    affirm?: AffirmSdk;
    _affirm_config?: AffirmConfig;
  }
}

export {};
