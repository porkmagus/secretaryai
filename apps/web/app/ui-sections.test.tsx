import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Next.js
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
}));

// Mock localStorage
const mockStorage: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: vi.fn((k: string) => mockStorage[k] ?? null),
    setItem: vi.fn((k: string, v: string) => {
      mockStorage[k] = v;
    }),
    removeItem: vi.fn((k: string) => {
      delete mockStorage[k];
    }),
    clear: vi.fn(() => {
      Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    }),
  },
  configurable: true,
});

// Mock @ai-sdk/react
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

// Mock fetch
beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response),
  );
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
});

describe("PersonaConsole", () => {
  it("renders persona heading", async () => {
    const { PersonaConsole } = await import("../app/persona/persona-console");
    render(<PersonaConsole />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });
});

describe("InferenceSettingsSection", () => {
  it("imports without error", async () => {
    const mod = await import("../app/persona/inference-settings-section");
    expect(mod.InferenceSettingsSection).toBeDefined();
  });
});

describe("PersonaIdentitySection", () => {
  it("imports without error", async () => {
    const mod = await import("../app/persona/persona-identity-section");
    expect(mod.PersonaIdentitySection).toBeDefined();
  });
});

describe("PersonaWritingSection", () => {
  it("imports without error", async () => {
    const mod = await import("../app/persona/persona-writing-section");
    expect(mod.PersonaWritingSection).toBeDefined();
  });
});

describe("MemoryBrowser", () => {
  it("renders memory browser", async () => {
    const { MemoryBrowser } = await import("../app/memory/memory-browser");
    render(<MemoryBrowser />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });
});

describe("ToolsConsole", () => {
  it("renders tools console", async () => {
    const { ToolsConsole } = await import("../app/tools/tools-console");
    render(<ToolsConsole />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });
});

describe("HeartbeatSettingsSection", () => {
  it("renders heartbeat settings", async () => {
    const { HeartbeatSettingsSection } = await import("../app/persona/heartbeat-settings-section");
    render(<HeartbeatSettingsSection />);
    expect(screen.getByRole("article")).toBeDefined();
  });
});
