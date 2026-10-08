# Monitor Glass v1.3.0

Monitor Glass 1.3.0 adapts to Monitor Hub 1.4.0 while preserving the existing interface and layout.

- Receives gzip-compressed public WebSocket snapshots when the browser supports `DecompressionStream`; keeps text-frame compatibility with older hubs and logged-in admin views.
- Suspends live connections, polling, and in-flight node requests while the page is hidden; immediately fetches a fresh snapshot and reconnects when it returns.
- Uses the hub-provided `last_seen_ago` for offline duration, with a safe client-clock fallback for older hubs.
- Uses the hub-overridable `/favicon.svg` and includes an opaque 180×180 iOS touch icon.
- Keeps the existing lazy-loaded charts, rendering, and page layout.

Install `theme.tar.gz` from the Monitor Hub theme page. The archive includes `dist/`, `theme.json`, and `preview.png`.
