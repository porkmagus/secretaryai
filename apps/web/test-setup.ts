import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock @ai-sdk/react hooks
vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(() => ({
    messages: [],
    sendMessage: vi.fn(),
    status: "ready",
    stop: vi.fn(),
    error: null,
    clearError: vi.fn(),
  })),
}));

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock window.matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window.requestAnimationFrame
vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) =>
  setTimeout(cb, 16),
);

// Mock window.scrollTo on Element prototype
Element.prototype.scrollTo = vi.fn();
