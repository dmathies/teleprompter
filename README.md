# GAOS Teleprompter

Web-based theatre teleprompter for live performances. The application is a
static HTML/JavaScript client with lightweight PHP synchronization and
filesystem persistence.

The browser client is built with [Vite](https://vitejs.dev/) and uses
[Lit](https://lit.dev/) Web Components, Sass stylesheets, and [unplugin-icons](https://github.com/unplugin/unplugin-icons).
`teleprompter_v2.html` defines the shell DOM and hosts the UI components,
`css/teleprompter.scss` and component-specific SCSS files define styles, and
the ES modules in `js/` implement the application:

- `js/main.js` is the entry point and coordinates live teleprompter behaviour;
- `js/components/` contains Lit Web Components:
  - `toolbar-transport.js`: playback, speed adjustments, and jumps;
  - `toolbar-display.js`: fullscreen, wake lock, stage directions toggle, settings, and PDF export;
  - `toolbar-navigation.js`: script, scene, and song navigation dropdowns;
  - `toolbar-sync.js`: script selection, ASM/department mode, credentials, rejoin, and health indicators;
  - `toolbar-sliders.js`: speed and font-size sliders;
  - `annotation-toolbar.js`: drawing tools, stroke widths, colors, undo, and clear;
  - `settings-dialog.js`: overview rail side and central department margin settings;
  - `export-dialog.js`: marked-up print/PDF export configuration;
  - `cue-editor-dialog.js`: cue creation, trigger-word anchoring, and range editing;
- `js/icons.js` bundles FontAwesome icons via `unplugin-icons`;
- `js/dom.js`, `js/semantic-position.js`, and `js/sync-protocol.js` isolate DOM
  lookup and synchronization primitives;
- `js/cue-text.js`, `js/annotation-geometry.js`, and
  `js/annotation-store.js` isolate cue and annotation support;
- `js/pdf-export.js` builds the separate print/PDF view;
- `js/utils.js` contains shared pure presentation helpers.

## Development and building

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the local PHP backend (in a separate terminal):
   ```sh
   php -S localhost:8000
   ```
3. Start the Vite dev server:
   ```sh
   npm run dev
   ```
   In dev mode, API requests from the Vite dev server automatically target
   `http://localhost:8000`.
4. Build for production:
   ```sh
   npm run build
   ```
   The bundled static output is emitted to `dist/`.

Because the client communicates with PHP synchronization endpoints, serve it
through a web server rather than opening HTML files directly from the filesystem.

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
