# PALETTE'S JOURNAL - CRITICAL LEARNINGS ONLY

## 2025-05-14 - Standardizing Accessible Notice Banners
**Learning:** In a single-user desk interface, dynamic feedback like success messages and error alerts must be explicitly announced by screen readers to ensure the "calm home" experience remains accessible to all operators.
**Action:** Always use `role="alert"` for errors and `role="status"` for info/success/warning in `NoticeBanner` components, coupled with `aria-live="polite"`.
## 2026-03-31 - [Micro-UX: Improving Chat and Nav Accessibility]
**Learning:** Screen reader users need explicit context for dynamic status changes and implicit keyboard shortcuts. Using `aria-live` and `aria-describedby` provides this bridge without cluttering the visual UI. Additionally, marking active navigation links with `aria-current="page"` is a critical standard for accessible wayfinding.
**Action:** Always link shortcut hints (like "Ctrl+Enter") to their respective inputs using `aria-describedby` and wrap status text in `aria-live="polite"` regions. Ensure navigation components have a clean way to apply `aria-current`.
## 2026-04-01 - [Action-Oriented Button Tooltips]
**Learning:** In a UI with custom action-oriented buttons (like "Speak" or "+"), users benefit significantly from descriptive tooltips (`title`) and ARIA labels. This provides immediate hover feedback and ensures screen readers convey the button's intent, especially when the icon or text might be generic or state-dependent.
**Action:** Always include both `title` and `aria-label` for buttons that perform specific actions or toggle states, ensuring they describe the *result* or *action* clearly.
## 2026-03-30 - Accessibility Polish Patterns
**Learning:** Common interactive elements (navigation links, status indicators, and notification banners) lacked standard ARIA attributes, making them less accessible to screen reader users. Specifically, active navigation items should use `aria-current="page"`, dynamic status indicators should use `role="status"`, and global notice banners should use live regions.
**Action:** Always check for `aria-current` on active navigation components and ensure dynamic UI updates are wrapped in appropriate ARIA live regions and roles.
## 2026-03-31 - Dual Accessibility Labels for Dynamic Controls
**Learning:** For interactive elements with state-dependent labels (like 'Speak'/'Stop') or icon-only buttons, providing both `aria-label` (for screen readers) and `title` (for visual tooltips) ensures a consistent and accessible experience for all users.
**Action:** Always pair `aria-label` with `title` on dynamic or icon-based controls to provide both technical and visual clarity.

## 2026-03-31 - Semantic Labeling for Form Accessibility
**Learning:** Using a proper `<label>` with `htmlFor` linked to an input's `id` is superior to using a simple `<p>` or `<span>` for field descriptions, as it provides a larger click target and correctly associates the text for assistive technologies.
**Action:** Ensure all form inputs (including textareas) are explicitly linked to a `<label>` element.
## 2025-05-14 - [Accessibility: Improving Chat Composer Context]
**Learning:** Standard text elements used as headers for input fields (like "Write to...") are often not programmatically linked to the input, leaving screen reader users without context when they focus the field. Additionally, dynamic status messages (like "is replying...") need explicit ARIA live regions to be useful for assistive technology.
**Action:** Always use semantic `<label htmlFor="...">` tags to associate titles with inputs, and apply `aria-live="polite"` to status regions that update asynchronously.
## 2026-03-31 - [Enhanced Accessibility and Semantics of the Desk Interface]
**Learning:** UX and accessibility should prioritize semantic HTML and ARIA attributes for interactive elements to improve the experience for keyboard and screen reader users. This includes using `<label>` for form fields, `aria-describedby` for help text, and `aria-live` for dynamic status updates.
**Action:** Always check for missing `<label>` tags for inputs and ensure toggle buttons (like "Speak") have state-aware `aria-label` attributes. Use `aria-live="polite"` for status messages to ensure they are announced without interruption.
## 2025-05-14 - [Composer Accessibility & Focus Flow]
**Learning:** Icon-only or instruction-heavy inputs (like chat composers) often lack formal label associations and ARIA descriptions for keyboard shortcut hints (e.g., "Ctrl+Enter"). Additionally, selecting automated suggestions often breaks the focus state of the primary input, creating friction for power users.
**Action:** Always link instructional text to the input using `aria-describedby` and ensure that clicking any suggestion chips or utility buttons programmatically returns focus to the main input to maintain interaction flow.
