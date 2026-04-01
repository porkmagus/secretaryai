## 2025-05-14 - [Composer Accessibility & Focus Flow]
**Learning:** Icon-only or instruction-heavy inputs (like chat composers) often lack formal label associations and ARIA descriptions for keyboard shortcut hints (e.g., "Ctrl+Enter"). Additionally, selecting automated suggestions often breaks the focus state of the primary input, creating friction for power users.
**Action:** Always link instructional text to the input using `aria-describedby` and ensure that clicking any suggestion chips or utility buttons programmatically returns focus to the main input to maintain interaction flow.
