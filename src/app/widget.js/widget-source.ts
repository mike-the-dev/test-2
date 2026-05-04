/**
 * The vanilla-JS embed script served at `/widget.js`.
 *
 * This string is returned verbatim by the route handler with a long cache
 * lifetime. It is plain ES5-safe JavaScript (no TypeScript, no JSX) so the
 * browser can execute it directly without transpilation.
 */
export const WIDGET_SOURCE = String.raw`(function () {
  try {
    var ROOT_ATTR = "data-instapaytient-widget";
    var CLOSE_MESSAGE_TYPE = "instapaytient:close";

    // Idempotent: if the widget already exists on the page, do nothing.
    if (document.querySelector("[" + ROOT_ATTR + "]")) {
      return;
    }

    // Locate the <script> tag that loaded this bundle so we can read (a) the
    // origin the iframe should point back to and (b) the integrator's public
    // account ID from its data-account-ulid attribute.
    var currentScript = document.currentScript;
    if (!currentScript) {
      var scripts = document.getElementsByTagName("script");
      for (var i = 0; i < scripts.length; i++) {
        if (scripts[i].src && scripts[i].src.indexOf("widget.js") !== -1) {
          currentScript = scripts[i];
          break;
        }
      }
    }
    var widgetOrigin = currentScript
      ? new URL(currentScript.src).origin
      : window.location.origin;
    var accountUlid =
      currentScript && currentScript.dataset
        ? currentScript.dataset.accountUlid || ""
        : "";
    if (!accountUlid) {
      // Non-fatal: the iframe will load and the backend will reject the
      // session-create call, surfacing a visible ChatErrorCard to the
      // visitor. A console.error here gives the integrator a direct signal
      // during testing.
      try {
        console.error(
          "[instapaytient] widget.js is missing data-account-ulid on its script tag"
        );
      } catch (_) {
        // console may be unavailable.
      }
    }

    var iframeUrl =
      widgetOrigin +
      "/embed?agent=shopping_assistant" +
      "&accountUlid=" +
      encodeURIComponent(accountUlid);

    // --- Root container. ----------------------------------------------------
    var root = document.createElement("div");
    root.setAttribute(ROOT_ATTR, "true");
    root.style.position = "fixed";
    root.style.right = "16px";
    root.style.bottom = "16px";
    root.style.zIndex = "2147483000";
    root.style.pointerEvents = "none";

    // --- StarBorder keyframes (injected once per page). -------------------
    var ipStyleEl = document.createElement("style");
    ipStyleEl.textContent =
      "@keyframes ip-star-bottom { 0% { transform: translate(0%, 0%); opacity: 1; } 100% { transform: translate(-100%, 0%); opacity: 0; } } " +
      "@keyframes ip-star-top { 0% { transform: translate(0%, 0%); opacity: 1; } 100% { transform: translate(100%, 0%); opacity: 0; } }";
    (document.head || document.documentElement).appendChild(ipStyleEl);

    // --- Floating chat bubble. ---------------------------------------------
    var bubble = document.createElement("button");
    bubble.type = "button";
    bubble.setAttribute("aria-label", "Open chat");
    bubble.style.pointerEvents = "auto";
    bubble.style.position = "relative";
    bubble.style.display = "flex";
    bubble.style.alignItems = "center";
    bubble.style.height = "56px";
    bubble.style.padding = "0 6px 0 20px";
    bubble.style.borderRadius = "9999px";
    bubble.style.overflow = "hidden";
    bubble.style.border = "none";
    bubble.style.cursor = "pointer";
    bubble.style.background = "#006FEE";
    bubble.style.color = "#ffffff";
    bubble.style.boxShadow = "0 10px 25px rgba(0, 111, 238, 0.35)";
    bubble.style.transition = "transform 150ms ease, background 150ms ease";
    bubble.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    bubble.innerHTML =
      '<span aria-hidden="true" style="position: absolute; width: 300%; height: 2px; opacity: 1; bottom: 0; right: -250%; background: radial-gradient(circle, magenta, transparent 10%); z-index: 0; animation: ip-star-bottom 5s linear infinite alternate; pointer-events: none;"></span>' +
      '<span aria-hidden="true" style="position: absolute; width: 300%; height: 2px; opacity: 1; top: 0; left: -250%; background: radial-gradient(circle, magenta, transparent 10%); z-index: 0; animation: ip-star-top 5s linear infinite alternate; pointer-events: none;"></span>' +
      '<span style="position: relative; z-index: 1; display: flex; align-items: center; gap: 14px;">' +
        '<span style="display: flex; flex-direction: column; align-items: flex-start; line-height: 1.15; text-align: left;">' +
          '<span style="font-size: 14px; font-weight: 700; white-space: nowrap;">Get Treated Now, Pay Later</span>' +
          '<span style="font-size: 11px; font-weight: 400; opacity: 0.92; white-space: nowrap;">Prequalify for your treatment here.</span>' +
        '</span>' +
        '<span style="display: flex; align-items: center; justify-content: center; height: 44px; padding: 0 14px; background: #ffffff; border-radius: 9999px;" aria-hidden="true">' +
        '<svg width="60" height="24" viewBox="0 0 429 171" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="affirm">' +
          '<g clip-path="url(#instapaytient-affirm-clip)">' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M28.1 156.27C22.8 156.27 20.1 153.66 20.1 149.37C20.1 141.37 29.02 138.68 45.29 136.95C45.29 147.61 38.08 156.27 28.05 156.27H28.1ZM35.1 96.3198C23.47 96.3198 10.1 101.79 2.83998 107.58L9.46998 121.58C15.29 116.25 24.7 111.69 33.19 111.69C41.26 111.69 45.72 114.39 45.72 119.83C45.72 123.48 42.77 125.33 37.19 126.06C16.33 128.76 -0.0200195 134.52 -0.0200195 150.59C-0.0200195 163.33 9.04998 171.04 23.22 171.04C33.34 171.04 42.34 165.42 46.62 158.04V169.04H65.48V122.95C65.48 103.95 52.29 96.2798 35.11 96.2798L35.1 96.3198Z" fill="black"/>' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M224.39 98.3902V168.95H244.57V134.95C244.57 118.8 254.35 114.05 261.16 114.05C264.226 114.026 267.229 114.914 269.79 116.6L273.48 97.9502C270.62 96.8056 267.559 96.2511 264.48 96.3202C254.11 96.3202 247.59 100.91 243.29 110.25V98.3902H224.39Z" fill="black"/>' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M367 96.3198C356.33 96.3198 348.35 102.62 344.2 108.7C340.35 100.85 332.2 96.3198 322.4 96.3198C311.74 96.3198 304.35 102.24 300.94 109.06V98.3898H281.48V168.95H301.68V132.62C301.68 119.62 308.51 113.33 314.88 113.33C320.65 113.33 325.95 117.06 325.95 126.69V168.95H346.11V132.62C346.11 119.43 352.77 113.33 359.44 113.33C364.78 113.33 370.44 117.21 370.44 126.55V168.95H390.6V120.17C390.6 104.32 379.93 96.3198 367.04 96.3198" fill="black"/>' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M175.28 98.3901H157V91.2201C157 81.8801 162.33 79.2201 166.92 79.2201C170.054 79.261 173.135 80.0313 175.92 81.4701L182.14 67.2401C182.14 67.2401 175.83 63.1201 164.36 63.1201C151.47 63.1201 136.8 70.3901 136.8 93.2001V98.3901H106.25V91.2201C106.25 81.8801 111.57 79.2201 116.17 79.2201C119.309 79.2199 122.4 79.9926 125.17 81.4701L131.39 67.2401C127.68 65.0701 121.71 63.1201 113.62 63.1201C100.73 63.1201 86.0599 70.3901 86.0599 93.2001V98.3901H74.3799V113.95H86.0899V168.95H106.25V113.95H136.84V168.95H157V113.95H175.28V98.3901Z" fill="black"/>' +
            '<path d="M207.46 98.3901H187.32V168.92H207.46V98.3901Z" fill="black"/>' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M188.06 86.4H207.79C219.3 50.21 258.35 18.4 304.79 18.4C361.27 18.4 410.08 61.4 410.08 128.34C410.252 142.08 408.364 155.769 404.48 168.95H423.63L423.82 168.29C427.047 155.241 428.639 141.842 428.56 128.4C428.56 53.75 374.16 0.0200195 304.83 0.0200195C250.37 0.0200195 201.83 37.82 188.07 86.42L188.06 86.4Z" fill="#4A4AF4"/>' +
          '</g>' +
          '<defs>' +
            '<clipPath id="instapaytient-affirm-clip">' +
              '<rect width="428.55" height="171" fill="white"/>' +
            '</clipPath>' +
          '</defs>' +
        '</svg>' +
        '</span>' +
      '</span>';
    bubble.addEventListener("mouseenter", function () {
      bubble.style.transform = "scale(1.05)";
    });
    bubble.addEventListener("mouseleave", function () {
      bubble.style.transform = "scale(1)";
    });

    // --- Iframe element. ---------------------------------------------------
    var iframe = null;
    var isOpen = false;
    var lastToggleAt = 0;

    function sizeIframe() {
      if (!iframe) return;
      // Reset any previous inset values first. The inset property is a
      // shorthand for top/right/bottom/left, so setting it to "" wipes all
      // four; setting the longhands after is what finalizes the position.
      iframe.style.inset = "";
      iframe.style.position = "fixed";
      if (window.innerWidth < 480) {
        iframe.style.top = "0";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.left = "0";
        iframe.style.width = "100vw";
        iframe.style.height = "100vh";
        iframe.style.borderRadius = "0";
      } else {
        iframe.style.top = "";
        iframe.style.left = "";
        iframe.style.right = "16px";
        iframe.style.bottom = "88px";
        iframe.style.width = "380px";
        iframe.style.height = "620px";
        iframe.style.borderRadius = "16px";
      }
    }

    function openPanel() {
      if (isOpen) return;
      iframe = document.createElement("iframe");
      iframe.setAttribute("title", "Instapaytient chat");
      // Force the browser to send the parent page's origin as the Referer on
      // the iframe load, regardless of the host page's Referrer-Policy. The
      // backend validates that origin against the account ID at /embed
      // render time — an unspoofable check that body fields can't give us.
      iframe.setAttribute("referrerpolicy", "origin");
      iframe.src = iframeUrl;
      iframe.style.border = "0";
      iframe.style.background = "#ffffff";
      iframe.style.boxShadow = "0 20px 40px rgba(0,0,0,0.25)";
      iframe.style.pointerEvents = "auto";
      iframe.style.zIndex = "2147483001";
      sizeIframe();
      root.appendChild(iframe);
      isOpen = true;
      bubble.setAttribute("aria-label", "Close chat");
    }

    function closePanel() {
      if (!isOpen) return;
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      iframe = null;
      isOpen = false;
      bubble.setAttribute("aria-label", "Open chat");
    }

    function toggle() {
      var now = Date.now();
      if (now - lastToggleAt < 250) return;
      lastToggleAt = now;
      if (isOpen) {
        closePanel();
      } else {
        openPanel();
      }
    }

    bubble.addEventListener("click", toggle);

    window.addEventListener("message", function (event) {
      var data = event && event.data;
      if (data && data.type === CLOSE_MESSAGE_TYPE) {
        closePanel();
      }
    });

    window.addEventListener("resize", function () {
      if (isOpen) sizeIframe();
    });

    root.appendChild(bubble);
    (document.body || document.documentElement).appendChild(root);
  } catch (err) {
    try {
      console.warn("[instapaytient] widget initialization failed", err);
    } catch (_) {
      // console may be unavailable; silently exit.
    }
  }
})();
`;
