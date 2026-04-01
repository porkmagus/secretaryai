## 2025-05-14 - [Accessibility: Improving Chat Composer Context]
**Learning:** Standard text elements used as headers for input fields (like "Write to...") are often not programmatically linked to the input, leaving screen reader users without context when they focus the field. Additionally, dynamic status messages (like "is replying...") need explicit ARIA live regions to be useful for assistive technology.
**Action:** Always use semantic `<label htmlFor="...">` tags to associate titles with inputs, and apply `aria-live="polite"` to status regions that update asynchronously.
