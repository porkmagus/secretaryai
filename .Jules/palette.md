## 2025-05-14 - [Accessibility: Improving Chat Composer Context]
**Learning:** Standard text elements used as headers for input fields (like "Write to...") are often not programmatically linked to the input, leaving screen reader users without context when they focus the field. Additionally, dynamic status messages (like "is replying...") need explicit ARIA live regions to be useful for assistive technology.
**Action:** Always use semantic `<label htmlFor="...">` tags to associate titles with inputs, and apply `aria-live="polite"` to status regions that update asynchronously.
## 2026-03-31 - [Enhanced Accessibility and Semantics of the Desk Interface]
**Learning:** UX and accessibility should prioritize semantic HTML and ARIA attributes for interactive elements to improve the experience for keyboard and screen reader users. This includes using `<label>` for form fields, `aria-describedby` for help text, and `aria-live` for dynamic status updates.
**Action:** Always check for missing `<label>` tags for inputs and ensure toggle buttons (like "Speak") have state-aware `aria-label` attributes. Use `aria-live="polite"` for status messages to ensure they are announced without interruption.
## 2025-05-14 - [Composer Accessibility & Focus Flow]
**Learning:** Icon-only or instruction-heavy inputs (like chat composers) often lack formal label associations and ARIA descriptions for keyboard shortcut hints (e.g., "Ctrl+Enter"). Additionally, selecting automated suggestions often breaks the focus state of the primary input, creating friction for power users.
**Action:** Always link instructional text to the input using `aria-describedby` and ensure that clicking any suggestion chips or utility buttons programmatically returns focus to the main input to maintain interaction flow.
