export function getTeleprompterDom() {
  const byId = id => document.getElementById(id);
  return {
    viewport: byId("viewport"),
    content: byId("content"),
    contextHeader: byId("contextHeader"),
    headerAct: byId("headerAct"),
    headerScene: byId("headerScene"),
    headerPage: byId("headerPage"),
    overviewRail: byId("overviewRail"),
    overviewMarkers: byId("overviewMarkers"),
    overviewViewportIndicator: byId("overviewViewportIndicator"),
    overviewMasterIndicator: byId("overviewMasterIndicator"),
    masterIdleBorder: byId("masterIdleBorder"),
    toolbarTransport: byId("toolbarTransport"),
    toolbarDisplay: byId("toolbarDisplay"),
    toolbarNavigation: byId("toolbarNavigation"),
    toolbarSync: byId("toolbarSync"),
    toolbarSliders: byId("toolbarSliders"),
    annotationToolbar: byId("annotationToolbar"),
    settingsDialog: byId("settingsDialog"),
    exportDialog: byId("exportDialog"),
    cueEditorDialog: byId("cueEditorDialog"),
  };
}
