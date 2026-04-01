## 2026-04-01 - [Action-Oriented Button Tooltips]
**Learning:** In a UI with custom action-oriented buttons (like "Speak" or "+"), users benefit significantly from descriptive tooltips (`title`) and ARIA labels. This provides immediate hover feedback and ensures screen readers convey the button's intent, especially when the icon or text might be generic or state-dependent.
**Action:** Always include both `title` and `aria-label` for buttons that perform specific actions or toggle states, ensuring they describe the *result* or *action* clearly.
