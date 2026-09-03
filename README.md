# GAOS Teleprompter

Web-based theatre teleprompter for live performances. The application is a
static HTML/JavaScript client with lightweight PHP synchronization and
filesystem persistence.

The browser client is served without a build step. `teleprompter.html` defines
the UI markup, `css/teleprompter.css` contains its styles, and the ES modules in
`js/` implement the application:

- `js/main.js` is the entry point and coordinates live teleprompter behaviour;
- `js/dom.js`, `js/semantic-position.js`, and `js/sync-protocol.js` isolate DOM
  lookup and synchronization primitives;
- `js/cue-text.js`, `js/annotation-geometry.js`, and
  `js/annotation-store.js` isolate cue and annotation support;
- `js/pdf-export.js` builds the separate print/PDF view;
- `js/utils.js` contains shared pure presentation helpers.

Because the entry point uses native JavaScript modules and fetches PHP
endpoints, run it through the target web server rather than opening
`teleprompter.html` directly from the filesystem.

Start with:

- [`AGENTS.md`](AGENTS.md) for repository working rules;
- [`docs/architecture.md`](docs/architecture.md) for components, roles,
  persistence, and deployment policy;
- [`docs/synchronization.md`](docs/synchronization.md) for master/follower
  behavior;
- [`docs/cues.md`](docs/cues.md) for cue storage, anchors, and rendering;
- [`docs/annotations.md`](docs/annotations.md) for annotation storage and
  offline synchronization;
- [`docs/script-format.md`](docs/script-format.md) for show-script markup;
- [`docs/settings.md`](docs/settings.md) for the browser-local rail and central
  department annotation margins;
- [`docs/export.md`](docs/export.md) for marked-up print/PDF output.

Copyrighted production scripts and writable runtime JSON are installed or
created during deployment and are intentionally not tracked. The repository
retains only directory placeholders and sanitized/public test content.

Before running authenticated endpoints, copy
`scripts/passwords.example.php` to the ignored `scripts/passwords.php`, replace
every placeholder, and provision that file separately in production.
