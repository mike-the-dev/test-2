/**
 * The vanilla-JS embed script served at `/widget.js`.
 *
 * This string is returned verbatim by the route handler with a long cache
 * lifetime. It is plain ES5-safe JavaScript (no TypeScript, no JSX) so the
 * browser can execute it directly without transpilation.
 */
export const WIDGET_SOURCE = String.raw`(function () {
  try {
    var STORAGE_KEY = "instapaytient_guest_id";
    var ROOT_ATTR = "data-instapaytient-widget";
    var CLOSE_MESSAGE_TYPE = "instapaytient:close";

    // Idempotent: if the widget already exists on the page, do nothing.
    if (document.querySelector("[" + ROOT_ATTR + "]")) {
      return;
    }

    // Locate the <script> tag that loaded this bundle so we can read (a) the
    // origin the iframe should point back to and (b) the integrator's public
    // account ULID from its data-account-ulid attribute.
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

    // --- Inline ULID generator (Crockford base32). ---------------------------
    var ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    function encodeTime(now, len) {
      var out = "";
      for (var j = len - 1; j >= 0; j--) {
        var mod = now % 32;
        out = ULID_ALPHABET.charAt(mod) + out;
        now = (now - mod) / 32;
      }
      return out;
    }
    function encodeRandom(len) {
      var bytes = new Uint8Array(len);
      window.crypto.getRandomValues(bytes);
      var out = "";
      for (var k = 0; k < len; k++) {
        out += ULID_ALPHABET.charAt(bytes[k] % 32);
      }
      return out;
    }
    function generateUlid() {
      return encodeTime(Date.now(), 10) + encodeRandom(16);
    }

    // --- Guest ID persistence with private-browsing fallback. ---------------
    var inMemoryGuestId = null;
    function ensureGuestId() {
      try {
        var existing = window.localStorage.getItem(STORAGE_KEY);
        if (existing && existing.length > 0) {
          return existing;
        }
        var created = generateUlid();
        window.localStorage.setItem(STORAGE_KEY, created);
        return created;
      } catch (e) {
        if (inMemoryGuestId) return inMemoryGuestId;
        inMemoryGuestId = generateUlid();
        return inMemoryGuestId;
      }
    }

    var guestId = ensureGuestId();
    var iframeUrl =
      widgetOrigin +
      "/embed?guestId=" +
      encodeURIComponent(guestId) +
      "&agent=shopping_assistant" +
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

    // --- Floating chat bubble. ---------------------------------------------
    var bubble = document.createElement("button");
    bubble.type = "button";
    bubble.setAttribute("aria-label", "Open chat");
    bubble.style.pointerEvents = "auto";
    bubble.style.display = "flex";
    bubble.style.alignItems = "center";
    bubble.style.justifyContent = "center";
    bubble.style.width = "56px";
    bubble.style.height = "56px";
    bubble.style.borderRadius = "9999px";
    bubble.style.border = "none";
    bubble.style.cursor = "pointer";
    bubble.style.background = "#006FEE";
    bubble.style.color = "#ffffff";
    bubble.style.boxShadow = "0 10px 25px rgba(0, 111, 238, 0.35)";
    bubble.style.transition = "transform 150ms ease, background 150ms ease";
    bubble.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
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
      // backend validates that origin against the account ULID at /embed
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
