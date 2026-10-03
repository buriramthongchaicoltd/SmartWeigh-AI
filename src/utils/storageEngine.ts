/**
 * Quota-safe localStorage writer (Pure localStorage Mode for System Testing):
 * - Saves data directly into browser `localStorage` so data persists across page refreshes (F5).
 * - If `localStorage` hits the 5MB browser limit due to multiple large Base64 bill images,
 *   it automatically strips only the heavy Base64 strings so all 39-column bill data is still saved in `localStorage`
 *   and never lost on refresh.
 */
export function safeSaveToLocalStorage<T = unknown>(
  key: string,
  records: T
): void {
  try {
    const valStr = typeof records === 'string' ? records : JSON.stringify(records);
    localStorage.setItem(key, valStr);
  } catch {
    try {
      if (Array.isArray(records)) {
        const lightweight = records.map((r) => {
          if (r && typeof r === 'object' && 'image' in r && (r as { image?: string | null }).image) {
            return { ...r, image: null };
          }
          return r;
        });
        localStorage.setItem(key, JSON.stringify(lightweight));
      }
    } catch (innerErr) {
      console.warn(`Failed to save ${key} to localStorage:`, innerErr);
    }
  }
}
