export function normalizeDepartmentMargin(margin) {
    const side = margin && (margin.side === "left" || margin.side === "right")
        ? margin.side
        : "none";
    const storedWidth = margin ? Number(margin.width) : 20;
    const width = Number.isFinite(storedWidth)
        ? Math.max(0, Math.min(40, Math.round(storedWidth)))
        : 20;
    return {side, width};
}

export function createDepartmentSettings({
    settingsDialog,
    content,
    settingsApiEndpoint,
    railSideStorageKey = "gaosTeleprompterRailSide",
    getActiveDepartment = () => null,
    getCueEditorUnlocked = () => false,
    getCueEditorKey = () => "",
    preserveSemanticPosition = (fn) => fn(),
    onLayoutChanged = null,
    scheduleToolbarHide = () => {}
}) {
    let railSide = "right";
    let departmentMargin = {side: "none", width: 20};
    let departmentSettingsRevision = 0;
    let departmentSettingsLoadSerial = 0;
    let departmentSettingsSaveRunning = false;
    let departmentSettingsSavePending = false;

    function loadDisplaySettings() {
        try {
            const storedRailSide = localStorage.getItem(railSideStorageKey);
            railSide = storedRailSide === "left" ? "left" : "right";
        } catch (_) {
            railSide = "right";
        }
    }

    function departmentMarginSetting() {
        return normalizeDepartmentMargin(departmentMargin);
    }

    function setSettingsSaveStatus(message, isError = false) {
        if (settingsDialog) {
            settingsDialog.saveStatus = message;
            settingsDialog.isError = isError;
        }
    }

    function syncSettingsControls() {
        const activeDepartment = getActiveDepartment();
        const cueEditorUnlocked = getCueEditorUnlocked();
        const margin = departmentMarginSetting();
        const canEditMargin = !!activeDepartment && cueEditorUnlocked;
        if (settingsDialog) {
            settingsDialog.railSide = railSide;
            settingsDialog.activeDepartment = activeDepartment;
            settingsDialog.canEditMargin = canEditMargin;
            settingsDialog.annotationMarginSide = activeDepartment ? margin.side : "none";
            settingsDialog.annotationMarginWidth = activeDepartment ? margin.width : 0;
        }

        if (!activeDepartment) {
            setSettingsSaveStatus("");
        } else if (!cueEditorUnlocked && !departmentSettingsSaveRunning) {
            setSettingsSaveStatus("Unlock " + activeDepartment + " editing to change its central margin.");
        } else if (cueEditorUnlocked && settingsDialog && settingsDialog.saveStatus && settingsDialog.saveStatus.startsWith("Unlock ")) {
            setSettingsSaveStatus("");
        }
    }

    async function loadCentralDepartmentSettings({preservePosition = true} = {}) {
        const activeDepartment = getActiveDepartment();
        if (!activeDepartment) return true;
        const department = activeDepartment;
        const serial = ++departmentSettingsLoadSerial;
        try {
            const response = await fetch(
                settingsApiEndpoint + "?action=get&dept=" + encodeURIComponent(department) + "&_=" + Date.now(),
                {cache: "no-store"}
            );
            if (!response.ok) throw new Error("Settings load HTTP " + response.status);
            const body = await response.json();
            if (serial !== departmentSettingsLoadSerial || department !== getActiveDepartment() ||
                departmentSettingsSavePending) return false;
            departmentSettingsRevision = Math.max(0, Number(body.revision) || 0);
            departmentMargin = normalizeDepartmentMargin(body.annotationMargin);
            applyDisplaySettings({preservePosition});
            return true;
        } catch (_) {
            if (serial === departmentSettingsLoadSerial && department === getActiveDepartment()) {
                setSettingsSaveStatus("Could not load central department settings.", true);
            }
            return false;
        }
    }

    async function flushDepartmentMarginSave() {
        if (departmentSettingsSaveRunning) return;
        departmentSettingsSaveRunning = true;

        try {
            while (departmentSettingsSavePending && getActiveDepartment() && getCueEditorUnlocked()) {
                departmentSettingsSavePending = false;
                const department = getActiveDepartment();
                const margin = departmentMarginSetting();
                setSettingsSaveStatus("Saving centrally…");

                try {
                    const response = await fetch(settingsApiEndpoint + "?action=save", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-Cue-Key": getCueEditorKey()
                        },
                        cache: "no-store",
                        body: JSON.stringify({department, annotationMargin: margin})
                    });
                    const text = await response.text();
                    let body = null;
                    try {
                        body = JSON.parse(text);
                    } catch (_) {
                    }
                    if (!response.ok) throw new Error((body && body.error) || "Settings update failed");
                    if (department === getActiveDepartment()) {
                        departmentSettingsRevision = Math.max(
                            departmentSettingsRevision,
                            Number(body && body.revision) || 0
                        );
                        if (!departmentSettingsSavePending) {
                            departmentMargin = normalizeDepartmentMargin(body && body.annotationMargin);
                            applyDisplaySettings({preservePosition: false});
                            setSettingsSaveStatus("Saved centrally.");
                        }
                    }
                } catch (_) {
                    if (department === getActiveDepartment() && !departmentSettingsSavePending) {
                        await loadCentralDepartmentSettings();
                        setSettingsSaveStatus("Central margin save failed; restored the server value.", true);
                    }
                }
            }
        } finally {
            departmentSettingsSaveRunning = false;
            syncSettingsControls();
        }
    }

    function queueDepartmentMarginSave(side, width) {
        if (!getActiveDepartment() || !getCueEditorUnlocked()) return;
        departmentMargin = normalizeDepartmentMargin({side, width});
        departmentSettingsSavePending = true;
        applyDisplaySettings();
        flushDepartmentMarginSave();
    }

    function applyDisplaySettings({preservePosition = true} = {}) {
        const activeDepartment = getActiveDepartment();
        const margin = departmentMarginSetting();
        const effectiveWidth = activeDepartment && margin.side !== "none"
            ? margin.width
            : 0;

        const apply = () => {
            document.body.classList.toggle("overview-rail-left", railSide === "left");
            content.style.setProperty(
                "--annotation-margin-left",
                margin.side === "left" ? effectiveWidth + "%" : "0px"
            );
            content.style.setProperty(
                "--annotation-margin-right",
                margin.side === "right" ? effectiveWidth + "%" : "0px"
            );
        };

        if (preservePosition && content.querySelector("[data-prompt-id]")) {
            preserveSemanticPosition(apply);
        } else {
            apply();
        }

        syncSettingsControls();

        if (onLayoutChanged) {
            onLayoutChanged();
        }
    }

    function openSettingsPanel() {
        syncSettingsControls();
        if (settingsDialog) {
            settingsDialog.show();
        }
        scheduleToolbarHide();
        applyDisplaySettings({preservePosition: false});
    }

    function closeSettingsPanel() {
        scheduleToolbarHide();
    }

    function handleDepartmentSettingsEvent(event) {
        const activeDepartment = getActiveDepartment();
        if (!activeDepartment || !event) return;

        let data = event.data;
        if (typeof data === "string") {
            try { data = JSON.parse(data); } catch (_) { return; }
        } else if (!data && typeof event === "object") {
            data = event;
        }

        // data can be {departments: {<dept>: {revision, annotationMargin}}}, or {dept, revision, annotationMargin}
        let deptEntry = null;
        if (data && data.departments && data.departments[activeDepartment]) {
            deptEntry = data.departments[activeDepartment];
        } else if (data && data.dept === activeDepartment) {
            deptEntry = data;
        } else if (event.dept === activeDepartment) {
            deptEntry = event;
        }

        if (!deptEntry) return;

        const rev = Number(deptEntry.revision) || 0;
        if (rev <= departmentSettingsRevision) return;
        if (departmentSettingsSavePending || departmentSettingsSaveRunning) return;
        departmentSettingsRevision = rev;
        if (deptEntry.annotationMargin) {
            departmentMargin = normalizeDepartmentMargin(deptEntry.annotationMargin);
            applyDisplaySettings();
        } else {
            loadCentralDepartmentSettings();
        }
    }

    return {
        loadDisplaySettings,
        departmentMarginSetting,
        syncSettingsControls,
        loadCentralDepartmentSettings,
        flushDepartmentMarginSave,
        queueDepartmentMarginSave,
        applyDisplaySettings,
        openSettingsPanel,
        closeSettingsPanel,
        handleDepartmentSettingsEvent,
        getRailSide: () => railSide,
        setRailSide: (val) => {
            railSide = val === "left" ? "left" : "right";
            try {
                localStorage.setItem(railSideStorageKey, railSide);
            } catch (_) {}
            applyDisplaySettings();
        },
        isSavePending: () => departmentSettingsSavePending,
        isSaveRunning: () => departmentSettingsSaveRunning
    };
}
