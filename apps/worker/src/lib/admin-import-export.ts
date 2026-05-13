import type { SettingsImportRequest } from "@secretary/core-runtime";

export {
  exportSettingsSnapshot,
  importSettingsSnapshot,
  exportSettingsSnapshot as exportSettings,
  importSettingsSnapshot as importSettings,
} from "./admin-runtime-core.js";

export function validateImportJson(value: unknown): value is SettingsImportRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "snapshot" in value &&
    typeof (value as { snapshot?: unknown }).snapshot === "object" &&
    (value as { snapshot?: unknown }).snapshot !== null
  );
}
