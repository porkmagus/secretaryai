## 2026-03-31 - Dual Accessibility Labels for Dynamic Controls
**Learning:** For interactive elements with state-dependent labels (like 'Speak'/'Stop') or icon-only buttons, providing both `aria-label` (for screen readers) and `title` (for visual tooltips) ensures a consistent and accessible experience for all users.
**Action:** Always pair `aria-label` with `title` on dynamic or icon-based controls to provide both technical and visual clarity.

## 2026-03-31 - Semantic Labeling for Form Accessibility
**Learning:** Using a proper `<label>` with `htmlFor` linked to an input's `id` is superior to using a simple `<p>` or `<span>` for field descriptions, as it provides a larger click target and correctly associates the text for assistive technologies.
**Action:** Ensure all form inputs (including textareas) are explicitly linked to a `<label>` element.
