// js/departments.js
// Dynamic department provider that delegates source of truth to the backend (scripts/util/api_common.php).
// Provides reactive helper methods and caching.

let cachedAllowedDepartments = [];
let cachedMetadata = {};
let fetchPromise = null;

/**
 * Fetch authoritative department definitions from the backend.
 * Caches the result and updates internal state.
 */
export async function fetchDepartments(endpoint = '/scripts/settings_api.php') {
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
        try {
            const res = await fetch(`${endpoint}?action=departments`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.departments) && data.departments.length > 0) {
                    cachedAllowedDepartments = data.departments;
                }
                if (data.metadata && typeof data.metadata === 'object') {
                    cachedMetadata = data.metadata;
                }
            }
        } catch (_) {
            // Keep existing cache
        } finally {
            fetchPromise = null;
        }
        return getDepartments();
    })();

    return fetchPromise;
}

export function getDepartments() {
    return cachedAllowedDepartments.slice();
}

export function getDepartmentMetadata() {
    return { ...cachedMetadata };
}

export function getDepartmentEntries() {
    return cachedAllowedDepartments.map((dept) => ({
        id: dept,
        label: getDepartmentLabel(dept),
        color: getDepartmentColor(dept),
    }));
}

export function isAllowedDepartment(dept) {
    if (!dept || typeof dept !== 'string') return false;
    const upper = dept.toUpperCase();
    return cachedAllowedDepartments.includes(upper);
}

export function normalizeDepartment(dept) {
    if (!dept || typeof dept !== 'string') return null;
    const upper = dept.toUpperCase();
    return cachedAllowedDepartments.includes(upper) ? upper : null;
}

export function getDepartmentLabel(dept) {
    if (!dept) return '';
    const upper = dept.toUpperCase();
    return (cachedMetadata[upper] && cachedMetadata[upper].label) || upper;
}

export function getDepartmentColor(dept) {
    if (!dept) return '#ffd000';
    const upper = dept.toUpperCase();
    return (cachedMetadata[upper] && cachedMetadata[upper].color) || '#ffd000';
}

export function getAllDepartmentColors() {
    const colors = {};
    for (const dept of cachedAllowedDepartments) {
        colors[dept] = getDepartmentColor(dept);
    }
    return colors;
}
