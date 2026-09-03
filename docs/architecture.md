# Architecture

## Runtime shape

The teleprompter is a static browser application with small PHP endpoints and
filesystem persistence. It deliberately has no JavaScript framework, build
pipeline, package manager, or database.

`teleprompter.html` owns nearly all client behaviour: display, autoscroll,
touch navigation, master/follower state, cue rendering/editing, annotations,
fullscreen, and wake lock.

The PHP endpoints are:

| Endpoint | Responsibility |
| --- | --- |
| `list_scripts.php` | Return readable entries from the script catalog. |
| `get_script.php` | Return one allow-listed HTML script fragment. |
| `teleprompter_sync.php` | Claim master control, write state, and serve polling reads. |
| `teleprompter_events.php` | Stream state, heartbeats, cue revisions, and annotation revisions over SSE. |
| `cue_api.php` | Read and mutate department cue documents and publish revision signals. |
| `annotation_api.php` | Read and mutate annotation documents and publish revision signals. |
| `settings_api.php` | Read central department display settings and perform authenticated updates. |
| `auth_cookie.php` | Issue and verify signed role cookies. |

All current browser clients use synchronization room `main`.

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
