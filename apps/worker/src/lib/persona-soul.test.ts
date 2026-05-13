import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  defaultSecretaryName,
  defaultSecretarySoul,
  defaultSecretaryPersonaProfile,
  createPersonaAvatarStorageKey,
  resolvePersonaStoragePath,
  getSecretarySoulFilePath,
  getSecretaryPersonaFilePath,
} from "./persona-soul.js";

test("defaultSecretaryName is SetAgentName", () => {
  assert.equal(defaultSecretaryName, "SetAgentName");
});

test("defaultSecretarySoul contains expected sections", () => {
  assert.ok(defaultSecretarySoul.includes("SetAgentName Soul"));
  assert.ok(defaultSecretarySoul.includes("private secretary"));
  assert.ok(defaultSecretarySoul.includes("warm, grounded, feminine"));
});

test("defaultSecretaryPersonaProfile contains identity and voice sections", () => {
  assert.ok(defaultSecretaryPersonaProfile.includes("SetAgentName Persona Profile"));
  assert.ok(defaultSecretaryPersonaProfile.includes("Identity"));
  assert.ok(defaultSecretaryPersonaProfile.includes("Voice"));
  assert.ok(defaultSecretaryPersonaProfile.includes("Memory posture"));
});

test("createPersonaAvatarStorageKey normalizes special characters", () => {
  assert.equal(createPersonaAvatarStorageKey("my avatar.png"), "persona/avatars/my-avatar.png");
  assert.equal(createPersonaAvatarStorageKey("hello world.jpg"), "persona/avatars/hello-world.jpg");
});

test("createPersonaAvatarStorageKey preserves alphanumeric dots and dashes", () => {
  assert.equal(createPersonaAvatarStorageKey("avatar-v2.0.png"), "persona/avatars/avatar-v2.0.png");
});

test("createPersonaAvatarStorageKey replaces multiple special chars with single dash", () => {
  assert.equal(createPersonaAvatarStorageKey("a!!!b"), "persona/avatars/a-b");
});

test("createPersonaAvatarStorageKey handles empty-ish strings", () => {
  assert.equal(createPersonaAvatarStorageKey("..."), "persona/avatars/...");
});

test("getSecretarySoulFilePath returns absolute path", () => {
  const path = getSecretarySoulFilePath();
  assert.ok(path.includes("secretary-soul.md"));
  assert.ok(path.startsWith("/"));
});

test("getSecretaryPersonaFilePath returns absolute path", () => {
  const path = getSecretaryPersonaFilePath();
  assert.ok(path.includes("secretary-persona.md"));
  assert.ok(path.startsWith("/"));
});
