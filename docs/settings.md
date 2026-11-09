# Display settings

The gear button on `<toolbar-display>` (`js/components/toolbar-display.js`) opens
a modal for display settings. Settings apply immediately and preserve the current
semantic script position while the layout reflows. The dialog is implemented as
the `<settings-dialog>` Web Component (`js/components/settings-dialog.js` and
`js/components/settings-dialog.scss`), mounted in `../teleprompter_v2.html`. Its
visual rules are in `css/teleprompter.scss` and `settings-dialog.scss`, client
state and event handling are coordinated in `js/main.js`, and central settings are
served by `scripts/settings_api.php`. Export consumes the same central settings
through `js/pdf-export.js`.

The settings dialog provides controls for:
- Font size slider (16px to 180px)
- Screen wake lock toggle ("Keep screen awake")
- Overview rail side (left or right)
- Central department annotation margin (side and width, when authenticated as department editor)

## Storage and scope

Font size, overview rail side, stage direction visibility, and the last selected
department and last viewed script are browser-local preferences stored in `localStorage`:
- `gaosTeleprompterRailSide`: Overview rail side (`left` or `right`).
- `gaosTeleprompterFontSize`: Font size in pixels (clamped between 16 and 180).
- `gaosTeleprompterStageDirections`: Stage direction visibility (`true` or `false`).
- `gaosTeleprompterDepartment`: Last selected department code (e.g. `FS`, `LX`). If no explicit `?dept=` query parameter is supplied in the URL, this saved selection is automatically restored. Explicit URL parameters override this and update the saved preference.
- `gaosTeleprompterScript`: Last successfully loaded script, including scripts loaded while following the master. Startup uses an available `?script=` selection first, then this saved script, then the first catalog entry. Fresh master state can subsequently select its script as usual; stored script selection does not restore a master state or position.
Font size applies directly to `#content` styling and preserves the semantic script position
during adjustments and layout reflow. Keep-screen-on state uses the Screen Wake Lock API.

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
With a nonzero margin, cue and END badges occupy that margin instead of adding
rows inside the script. Thin leaders connect each label to its anchor. Labels
on the same text line, including multiple cues on one word, receive separate
non-overlapping slots and leader lanes. The final leader segments run just
below the target words. Without a margin, cue badges retain their full-width
row layout. Rail and range graphics continue to use their semantic anchors.

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

Cue-enabled print exports also respect central margins when annotations are
disabled. In an all-department export, cues use their department's configured
side where available; departments without a margin use an available shared
margin. Print labels are packed within each page and export reports an error
if the labels cannot fit, rather than clipping or dropping them.

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
