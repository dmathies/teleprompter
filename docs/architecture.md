# Architecture

## Runtime shape

The teleprompter is a static browser application with small PHP endpoints and
filesystem persistence. It deliberately has no JavaScript framework, build
pipeline, package manager, or database.

The browser uses native ES modules. There is no generated bundle: these source
files are deployed and served directly.

| Client file | Responsibility |
| --- | --- |
| `teleprompter.html` | DOM shell for the toolbar, dialogs, overview rail, annotation tools, and script viewport. It loads the stylesheet and module entry point but contains no application logic. |
| `css/teleprompter.css` | All application layout and visual states, including responsive, cue, annotation, rail, modal, and follow/master styling. |
| `js/main.js` | Browser entry point and coordinator: script loading, display and navigation, master/follower control flow, cue and annotation workflows, settings, fullscreen, and wake lock. |
| `js/dom.js` | Central lookup of the fixed teleprompter DOM elements consumed by `main.js`. |
| `js/semantic-position.js` | Validation, capture, comparison, and DOM mapping of prompt-and-fraction semantic positions. |
| `js/sync-protocol.js` | State-delivery age validation and stable motion signatures used by synchronization. |
| `js/cue-text.js` | Script text-node enumeration, cue word indexing, and live trigger-word wrapping. |
| `js/annotation-geometry.js` | Live annotation coordinate conversion, SVG shape construction, scaling, and layer cleanup. |
| `js/annotation-store.js` | IndexedDB access for cached annotation documents and queued offline operations. |
| `js/pdf-export.js` | Browser-generated print/PDF view, including export data loading, markup decoration, pagination, and print annotation rendering. |
| `js/utils.js` | Shared pure colour and health-display helpers used by the browser modules. |

`teleprompter.html` loads `js/main.js` with `type="module"`. `main.js` imports
the focused modules and creates their stateful APIs by passing explicit DOM
elements and accessors. `pdf-export.js` imports the shared colour helper and
semantic-position normalization, while `main.js` injects its required dialog
elements, endpoints, settings normalization, and current-state accessors. The
feature modules do not own the application's live top-level state. Keep this
direction of dependency when moving code between modules, and avoid introducing
globals merely to cross a module boundary.

The client must be served over HTTP(S), rather than opened as a local file, so
native module loading and endpoint requests use the same web origin.

The PHP endpoints are:

| Endpoint | Responsibility |
| --- | --- |
| `list_scripts.php` | Return readable entries from the script catalog. |
| `get_script.php` | Return one allow-listed HTML script fragment. |
| `teleprompter_sync.php` | Claim master control, write state, and serve polling reads. |
| `teleprompter_events.php` | Stream state, heartbeats, cue revisions, annotation revisions, and central settings over SSE. |
| `cue_api.php` | Read and mutate department cue documents and publish revision signals. |
| `annotation_api.php` | Read and mutate annotation documents and publish revision signals. |
| `settings_api.php` | Read central department display settings and perform authenticated updates. |
| `auth_cookie.php` | Issue and verify signed role cookies. |

All current browser clients use synchronization room `main`.

## Where to make browser changes

- Change `teleprompter.html` when controls or dialog structure changes, and
  update the corresponding element lookup and event wiring in `js/main.js`.
- Change `css/teleprompter.css` for visual or responsive behaviour; script
  fragments may still provide narrowly scoped show-specific styles.
- Change `js/main.js` for live display, synchronization, cues, annotations, or
  settings coordination and event wiring.
- Change the focused `js/` module that owns a reusable primitive rather than
  duplicating its logic in `js/main.js` or `js/pdf-export.js`.
- Change `js/pdf-export.js` for the generated print document. Export has its
  own stylesheet and DOM, so screen-CSS changes do not automatically affect it.
- Put a helper in `js/utils.js` only when it is state-free and genuinely shared
  by browser modules.

## Client roles

The default client is a follower. ASM can authenticate and claim master
control. A URL query such as `?dept=LX` creates a department follower; its
department password unlocks cue and annotation editing but never master control.

Master identity is a random value in `sessionStorage`, so it survives reloads
in the same tab. Authentication is retained separately in secure HTTP-only
cookies for 24 hours.

Rail side is kept in `localStorage` and shared by all views in that browser.
Annotation margin settings are instead central, keyed by department, and
stored as ignored runtime data. Updates require the matching department editor
login and are announced to open clients over SSE.

## Persistent and operational data

| Path | Contents |
| --- | --- |
| `show-scripts/` | Deployed HTML fragments. Production files may be untracked because of copyright. |
| `show-cues/` | Ignored deployment data: per-script/per-department cue JSON. |
| `show-annotations/` | Ignored deployment data: per-script/per-department annotation JSON. |
| `scripts/teleprompter_state/<room>.json` | Ignored runtime data: latest master state. |
| `scripts/teleprompter_state/<room>.master.json` | Ignored runtime data: master owner and lease timestamps. |
| `scripts/teleprompter_state/annotation_revisions.json` | Ignored runtime data: annotation revision notification map. |
| `scripts/teleprompter_state/cue_revisions.json` | Ignored runtime data: cue revision notification map. |
| `scripts/teleprompter_state/department_settings.json` | Ignored runtime data: central revisioned annotation-margin settings by department. |

Annotation files belong only in the root `show-annotations/` directory. The
application does not read annotation data from beneath `scripts/`.

See `settings.md` for the preference keys and the relationship between margins,
script text, cues, and annotation coordinates.

Print/PDF export has no server-side renderer or generated PDF file. The browser
opens a separate print document, fetches the allow-listed script plus persisted
department data through the existing read endpoints, lays it out as A4 sheets,
and delegates printing or PDF creation to the browser. See `export.md`.

## Credential configuration

Master and department credentials are stored together in the ignored
`scripts/passwords.php` file. Its tracked schema is
`scripts/passwords.example.php`:

```php
return [
    'master' => '...',
    'departments' => [
        'FS' => '...',
        'LX' => '...',
        'SND' => '...',
        'STG' => '...',
    ],
];
```

The real file must be provisioned separately because Git ignores it. A Git-only
deployment without `scripts/passwords.php` leaves authenticated endpoints
unavailable. On production:

1. Copy the example to `scripts/passwords.php` outside the Git deployment
   process and fill every value.
2. Rotate every value that previously appeared in repository history; those
   credentials must be considered disclosed. Rotation invalidates existing
   signed authentication cookies.
3. Remove the obsolete deployed `scripts/cue_passwords.php` manually. The
   deployment pipeline preserves deleted files and will not remove it.
4. Restrict filesystem access to the secret file and ensure the web server
   executes PHP rather than serving its source.
5. Back up the secret through the hosting secret-management process, not Git.

Do not store raw passwords in browser storage or query strings. Rewriting public
Git history is optional defense-in-depth after rotation and requires a separate,
coordinated decision.

## Runtime-data Git policy

State, central department settings, cue, and annotation JSON are mutable
production data. They are ignored under `scripts/teleprompter_state/`,
`show-cues/`, and `show-annotations/` and have been removed from the current Git
index without deleting working copies.
Each directory has a tracked `.gitkeep` so a fresh deployment creates the
required path.

The deployment pipeline is expected not to delete ignored files. It must also
keep these directories writable and persistent across releases. Production
operations should back them up and prevent unintended directory listing or
direct disclosure.

Previously committed JSON remains in Git history. Rewriting public history is
not required for normal operation and must be a separately approved,
coordinated change. Put sanitized examples in a dedicated fixture directory if
future automated tests need them; do not re-add live files with `git add -f`.

## Copyrighted scripts

`.gitignore` intentionally excludes `show-scripts/*` and allow-lists only the
public-domain Pirates test script. The catalog may name production files that
are installed separately on the server. `list_scripts.php` omits catalog entries
whose files are unavailable, allowing a public clone to work with only its test
fixture.
