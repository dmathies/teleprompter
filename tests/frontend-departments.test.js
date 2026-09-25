import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchDepartments,
  getDepartments,
  getDepartmentMetadata,
  getDepartmentEntries,
  isAllowedDepartment,
  getDepartmentLabel,
  getDepartmentColor
} from '../js/departments.js';

describe('Frontend Department Provider (js/departments.js)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('isAllowedDepartment validates membership and ignores case', () => {
    // When departments are empty or defaulted, invalid returns false
    assert.equal(isAllowedDepartment(''), false);
    assert.equal(isAllowedDepartment(null), false);
    assert.equal(isAllowedDepartment('UNKNOWN_DEPT'), false);
  });

  test('fetchDepartments fetches, populates cache, and dedupes concurrent requests', async () => {
    let callCount = 0;
    const mockPayload = {
      ok: true,
      departments: ['FS', 'LX', 'SND', 'STG', 'FLY'],
      metadata: {
        FLY: { label: 'Fly Gallery', color: '#ff5500' },
        LX: { label: 'Lighting', color: '#2f80ed' }
      }
    };

    globalThis.fetch = async (url) => {
      callCount++;
      return {
        ok: true,
        json: async () => mockPayload
      };
    };

    // Trigger two calls concurrently to verify request deduplication
    const [res1, res2] = await Promise.all([
      fetchDepartments('/scripts/settings_api.php'),
      fetchDepartments('/scripts/settings_api.php')
    ]);

    assert.equal(callCount, 1, 'concurrent fetchDepartments calls should be deduped');
    assert.deepEqual(res1, ['FS', 'LX', 'SND', 'STG', 'FLY']);
    assert.deepEqual(res2, ['FS', 'LX', 'SND', 'STG', 'FLY']);
    assert.deepEqual(getDepartments(), ['FS', 'LX', 'SND', 'STG', 'FLY']);

    // Check membership with new department
    assert.equal(isAllowedDepartment('fly'), true);
    assert.equal(isAllowedDepartment('FLY'), true);
    assert.equal(isAllowedDepartment('lx'), true);
    assert.equal(isAllowedDepartment('NON_EXISTENT'), false);

    // Check metadata helper methods
    assert.equal(getDepartmentLabel('FLY'), 'Fly Gallery');
    assert.equal(getDepartmentColor('FLY'), '#ff5500');
    assert.equal(getDepartmentLabel('UNKNOWN'), 'UNKNOWN', 'unknown department falls back to code');

    // Check structured entries
    const entries = getDepartmentEntries();
    assert.equal(entries.length, 5);
    const flyEntry = entries.find(e => e.id === 'FLY');
    assert.deepEqual(flyEntry, {
      id: 'FLY',
      label: 'Fly Gallery',
      color: '#ff5500'
    });
  });

  test('fetchDepartments keeps existing cache on network failure', async () => {
    const prev = getDepartments();
    globalThis.fetch = async () => {
      throw new Error('Network offline');
    };

    const res = await fetchDepartments('/scripts/settings_api.php');
    assert.deepEqual(res, prev, 'should retain previous cache if network fails');
  });
});
