# PALETTE'S JOURNAL - CRITICAL LEARNINGS ONLY

## 2025-05-14 - Standardizing Accessible Notice Banners
**Learning:** In a single-user desk interface, dynamic feedback like success messages and error alerts must be explicitly announced by screen readers to ensure the "calm home" experience remains accessible to all operators.
**Action:** Always use `role="alert"` for errors and `role="status"` for info/success/warning in `NoticeBanner` components, coupled with `aria-live="polite"`.
