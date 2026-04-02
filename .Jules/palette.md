## 2026-03-31 - [Live Status and Focus Management Patterns]
**Learning:** Dynamic UI elements like typing indicators and status messages must use ARIA roles (role="status") and live regions (aria-live="polite") to be accessible. In chat interfaces, returning focus to the input after a side-action (like clicking a suggestion) preserves user flow.
**Action:** Always link hints to inputs via aria-describedby and ensure focus returns to primary inputs after secondary interactions.
