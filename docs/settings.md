# Display settings

The gear button opens a modal for display settings. Settings apply immediately
and preserve the current semantic script position while the layout reflows.
The dialog markup is in `teleprompter.html`, its visual rules are in
`css/teleprompter.css`, client state and event handling are in `js/main.js`, and
central settings are served by `scripts/settings_api.php`. Export consumes the
same central settings through `js/pdf-export.js`.

## Storage and scope

The overview rail side is browser-local. It uses the `localStorage` key
`gaosTeleprompterRailSide`, whose value is `left` or `right`.

Annotation margins are central operational settings stored in the ignored
`scripts/teleprompter_state/department_settings.json` file. The document has a
global revision and one independently revisioned entry for each department:

```json
{
  "revision": 1,
  "departments": {
    "LX": {
      "revision": 1,
      "annotationMargin": {"side": "left", "width": 20}
    }
  }
}
```

`settings_api.php` permits public reads for department displays. Updates
require the matching `FS`, `LX`, `SND`, or `STG` editor password or signed
authentication cookie. The width is a percentage of the content area, clamped
to 0–40%. A department with no central entry defaults to no margin; selecting a
side initially offers a 20% drawing margin.

The central file must remain writable and persistent across deployments and
must not be committed. Changes are emitted as `department-settings` SSE events,
so open displays for that department adopt the new layout without reloading.

## Rail side

Moving the overview rail changes the reserved 18-pixel viewport edge and the
context header inset. It does not change the authoritative master position,
cue data, annotation data, or another browser's layout.

## Annotation margin

A left or right margin is implemented as padding on each semantic prompt block.
Only the script text is indented. Cue badges, marker lines, range lines, and
connectors retain the full content width and may extend through the margin.

Annotation X coordinates are relative to the prompt area remaining after the
configured margin rather than to screen pixels. Existing cue/script padding is
excluded, so installing this version with margins disabled leaves saved
annotations unchanged. Changing the margin moves and reflows annotations with
their associated text. Coordinates outside the area's 0–1 interval are
intentionally retained so drawing in the blank margin remains possible.

Print/PDF export fetches these central margins with the selected department
data. A single-department export uses that department's margin. An
all-department export reserves the largest selected left and right margins so
each department's annotations have space.

## Adding settings

Keep personal display preferences local; use central ignored runtime data for
department settings that must be shared for show operation. Central writes need
role-appropriate authentication and an SSE revision signal. New layout settings
must preserve semantic position and trigger cue, annotation, overview-rail, and
context-header redraws after reflow.

Colour schemes are a suitable future extension of this dialog, but no scheme
selector is currently defined. Any implementation should use a documented set
of CSS custom properties and preserve the semantic department cue colours and
the contrast of follow, paused, waiting, stale, and master states.
