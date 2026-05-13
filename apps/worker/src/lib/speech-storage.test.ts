import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createSpeechStorageKey,
  normalizeSpeechStorageKey,
  resolveManagedSpeechStoragePath,
} from "./speech-storage.js";

test("normalizeSpeechStorageKey collapses Windows separators", () => {
  assert.equal(
    normalizeSpeechStorageKey("speech\\tts\\1774386755950-voice-preview.wav"),
    "speech/tts/1774386755950-voice-preview.wav",
  );
});

test("createSpeechStorageKey always uses forward slashes", () => {
  assert.equal(createSpeechStorageKey("tts", "voice preview.wav"), "speech/tts/voice-preview.wav");
});

test("resolveManagedSpeechStoragePath accepts normalized legacy keys", () => {
  const resolved = resolveManagedSpeechStoragePath("speech\\profiles\\sample.mp3");
  assert.match(resolved, /runtime[\\/]speech[\\/]profiles[\\/]sample\.mp3$/);
});
