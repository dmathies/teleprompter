import './harness/register-loader.js';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SettingsDialog } from '../js/components/settings-dialog.js';
import { ExportDialog } from '../js/components/export-dialog.js';
import { CueEditorDialog } from '../js/components/cue-editor-dialog.js';
import { ToolbarSync } from '../js/components/toolbar-sync.js';

describe('Frontend Modal & Dialog Components', () => {
  describe('SettingsDialog (<settings-dialog>)', () => {
    let dialog;

    beforeEach(() => {
      dialog = new SettingsDialog();
    });

    test('initializes with expected default property values', () => {
      assert.equal(dialog.open, false);
      assert.equal(dialog.fontSize, 42);
      assert.equal(dialog.wakeLockActive, false);
      assert.equal(dialog.railSide, 'right');
      assert.equal(dialog.annotationMarginSide, 'none');
      assert.equal(dialog.annotationMarginWidth, 0);
      assert.equal(dialog.canEditMargin, false);
    });

    test('show() and close() manage open state and dispatch close event', () => {
      let closeDispatched = false;
      dialog.addEventListener('close', () => {
        closeDispatched = true;
      });

      dialog.open = true;
      assert.equal(dialog.open, true);

      dialog.close();
      assert.equal(dialog.open, false);
      assert.equal(closeDispatched, true);
    });

    test('dispatches font-size-input and font-size-change events', () => {
      const inputEvents = [];
      const changeEvents = [];

      dialog.addEventListener('font-size-input', (e) => inputEvents.push(e.detail.fontSize));
      dialog.addEventListener('font-size-change', (e) => changeEvents.push(e.detail.fontSize));

      dialog._onFontSizeInput({ target: { value: '48' } });
      assert.equal(dialog.fontSize, 48);
      assert.deepEqual(inputEvents, [48]);

      dialog._onFontSizeChange({ target: { value: '54' } });
      assert.equal(dialog.fontSize, 54);
      assert.deepEqual(changeEvents, [54]);
    });

    test('dispatches toggle-wakelock event', () => {
      let wakeLockToggled = false;
      dialog.addEventListener('toggle-wakelock', () => {
        wakeLockToggled = true;
      });

      dialog._onWakeLock();
      assert.equal(wakeLockToggled, true);
    });

    test('dispatches rail-side-change event with validated direction', () => {
      const railEvents = [];
      dialog.addEventListener('rail-side-change', (e) => railEvents.push(e.detail.railSide));

      dialog._onRailSideChange({ target: { value: 'left' } });
      assert.equal(dialog.railSide, 'left');

      dialog._onRailSideChange({ target: { value: 'anything_else' } });
      assert.equal(dialog.railSide, 'right');

      assert.deepEqual(railEvents, ['left', 'right']);
    });

    test('dispatches margin-input and margin-change events', () => {
      const marginInputs = [];
      const marginChanges = [];

      dialog.addEventListener('margin-input', (e) => marginInputs.push(e.detail.width));
      dialog.addEventListener('margin-change', (e) => marginChanges.push(e.detail));

      dialog.annotationMarginWidth = 15;
      dialog._onMarginSideChange({ target: { value: 'left' } });
      assert.equal(dialog.annotationMarginSide, 'left');
      assert.deepEqual(marginChanges, [{ side: 'left', width: 15 }]);

      dialog._onMarginWidthInput({ target: { value: '25' } });
      assert.equal(dialog.annotationMarginWidth, 25);
      assert.deepEqual(marginInputs, [25]);

      dialog._onMarginWidthChange({ target: { value: '30' } });
      assert.equal(dialog.annotationMarginWidth, 30);
      assert.deepEqual(marginChanges, [
        { side: 'left', width: 15 },
        { side: 'left', width: 30 }
      ]);
    });
  });

  describe('ExportDialog (<export-dialog>)', () => {
    let dialog;

    beforeEach(() => {
      dialog = new ExportDialog();
    });

    test('initializes with default export options', () => {
      assert.equal(dialog.open, false);
      assert.equal(dialog.department, 'ALL');
      assert.equal(dialog.stageDirections, 'all');
      assert.equal(dialog.exportCues, true);
      assert.equal(dialog.exportAnnotations, true);
      assert.equal(dialog.busy, false);
    });

    test('show(initialDept) resets status and sets active department', () => {
      dialog.status = 'An error occurred';
      dialog.isError = true;
      dialog.busy = true;

      dialog.show('STG');
      assert.equal(dialog.open, true);
      assert.equal(dialog.department, 'STG');
      assert.equal(dialog.status, '');
      assert.equal(dialog.isError, false);
      assert.equal(dialog.busy, false);
    });

    test('close() sets open to false and dispatches close event', () => {
      let closed = false;
      dialog.addEventListener('close', () => { closed = true; });

      dialog.open = true;
      dialog.close();
      assert.equal(dialog.open, false);
      assert.equal(closed, true);
    });

    test('dispatches export event with complete configuration payload', () => {
      let exportPayload = null;
      dialog.addEventListener('export', (e) => {
        exportPayload = e.detail;
      });

      dialog.department = 'LX';
      dialog.stageDirections = 'relevant';
      dialog.exportCues = true;
      dialog.exportAnnotations = false;

      dialog._onExportClick();

      assert.deepEqual(exportPayload, {
        department: 'LX',
        stageDirections: 'relevant',
        exportCues: true,
        exportAnnotations: false,
      });
    });

    test('option change handlers update properties correctly', () => {
      dialog._onDepartmentChange({ target: { value: 'FS' } });
      assert.equal(dialog.department, 'FS');

      dialog._onStageDirectionsChange({ target: { value: 'hide' } });
      assert.equal(dialog.stageDirections, 'hide');

      dialog._onCuesChange({ target: { checked: false } });
      assert.equal(dialog.exportCues, false);

      dialog._onAnnotationsChange({ target: { checked: false } });
      assert.equal(dialog.exportAnnotations, false);
    });
  });

  describe('CueEditorDialog (<cue-editor-dialog>)', () => {
    let dialog;

    beforeEach(() => {
      dialog = new CueEditorDialog();
    });

    test('initializes with default cue fields', () => {
      assert.equal(dialog.open, false);
      assert.equal(dialog.isEditing, false);
      assert.equal(dialog.department, 'LX');
      assert.equal(dialog.cueNumber, '');
      assert.equal(dialog.description, '');
      assert.equal(dialog.color, '#ffd000');
      assert.equal(dialog.endInfo, 'No end position');
      assert.equal(dialog.positionTracking, null);
    });

    test('dispatches save event with cue payload', () => {
      let savedData = null;
      dialog.addEventListener('save', (e) => {
        savedData = e.detail;
      });

      dialog.cueNumber = '101';
      dialog.description = 'Blackout';
      dialog.color = '#ff0000';

      dialog._onSaveClick();

      assert.deepEqual(savedData, {
        number: '101',
        description: 'Blackout',
        color: '#ff0000',
      });
    });

    test('dispatches tracking and word pick events', () => {
      const events = [];
      dialog.addEventListener('choose-word', () => events.push('choose-word'));
      dialog.addEventListener('toggle-track-start', () => events.push('toggle-track-start'));
      dialog.addEventListener('toggle-track-end', () => events.push('toggle-track-end'));
      dialog.addEventListener('clear-end', () => events.push('clear-end'));
      dialog.addEventListener('delete', () => events.push('delete'));

      dialog._onChooseWordClick();
      dialog._onTrackStartClick();
      dialog._onTrackEndClick();
      dialog._onClearEndClick();
      dialog._onDeleteClick();

      assert.deepEqual(events, [
        'choose-word',
        'toggle-track-start',
        'toggle-track-end',
        'clear-end',
        'delete',
      ]);
    });
  });

  describe('ToolbarSync Password Modal & Auth flow (<toolbar-sync>)', () => {
    let sync;

    beforeEach(() => {
      sync = new ToolbarSync();
    });

    test('initializes with closed password modal', () => {
      assert.equal(sync.passwordOpen, false);
      assert.equal(sync.cueEditorUnlocked, false);
      assert.equal(sync.isMaster, false);
      assert.equal(sync.canRejoin, false);
    });

    test('submits password and dispatches submit-password event', () => {
      let submittedPassword = null;
      sync.addEventListener('submit-password', (e) => {
        submittedPassword = e.detail.password;
      });

      // Mock password input getter
      sync.getPasswordValue = () => 'secret123';

      sync._onSubmitPassword();
      assert.equal(submittedPassword, 'secret123');
    });

    test('dispatches take-control event with password', () => {
      let takeControlPassword = null;
      sync.addEventListener('take-control', (e) => {
        takeControlPassword = e.detail.password;
      });

      sync.getPasswordValue = () => 'masterpass';
      sync._onTakeControl();
      assert.equal(takeControlPassword, 'masterpass');
    });

    test('cancelling password clears state and dispatches cancel-password', () => {
      let cancelled = false;
      sync.addEventListener('cancel-password', () => {
        cancelled = true;
      });

      let cleared = false;
      sync.clearPassword = () => { cleared = true; };
      sync.passwordOpen = true;

      sync._onCancelPassword();
      assert.equal(sync.passwordOpen, false);
      assert.equal(cleared, true);
      assert.equal(cancelled, true);
    });

    test('dispatches select-department event', () => {
      let selectedDept = null;
      sync.addEventListener('select-department', (e) => {
        selectedDept = e.detail.department;
      });

      sync._onDepartmentChange({ target: { value: 'SND' } });
      assert.equal(selectedDept, 'SND');
    });
  });
});
