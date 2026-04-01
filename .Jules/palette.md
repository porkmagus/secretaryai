## 2026-03-30 - Accessibility Polish Patterns
**Learning:** Common interactive elements (navigation links, status indicators, and notification banners) lacked standard ARIA attributes, making them less accessible to screen reader users. Specifically, active navigation items should use `aria-current="page"`, dynamic status indicators should use `role="status"`, and global notice banners should use live regions.
**Action:** Always check for `aria-current` on active navigation components and ensure dynamic UI updates are wrapped in appropriate ARIA live regions and roles.
