"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PersonaAvatarRecord,
  PersonaSettingsResponse,
} from "@secretary/core-runtime";

type SecretaryPortraitFieldProps = {
  avatar: PersonaAvatarRecord | null | undefined;
  name: string;
  onUploaded?: (next: PersonaSettingsResponse) => void;
  onStatusChange?: (message: string | null, tone: "error" | "success") => void;
  variant?: "desk" | "settings";
};

type InspectedImage = {
  width: number;
  height: number;
  cropHint: string;
};

const acceptedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

function buildPortraitUrl(avatar: PersonaAvatarRecord | null | undefined) {
  if (!avatar?.storageKey) {
    return null;
  }

  const params = new URLSearchParams({
    storageKey: avatar.storageKey,
  });

  if (avatar.mimeType) {
    params.set("mimeType", avatar.mimeType);
  }

  if (avatar.updatedAt) {
    params.set("updatedAt", avatar.updatedAt);
  }

  return `/api/persona/avatar?${params.toString()}`;
}

function inspectImage(file: File) {
  return new Promise<InspectedImage>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      const aspect = width / height;
      let cropHint = "Good fit for the portrait frame.";

      if (aspect > 0.95) {
        cropHint = "Square or landscape photos will crop tighter around the face.";
      } else if (aspect < 0.72) {
        cropHint = "Very tall photos may leave less room around the shoulders.";
      }

      URL.revokeObjectURL(objectUrl);
      resolve({ width, height, cropHint });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("That image could not be read."));
    };

    image.src = objectUrl;
  });
}

export function SecretaryPortraitField({
  avatar,
  name,
  onUploaded,
  onStatusChange,
  variant = "desk",
}: SecretaryPortraitFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedImage, setSelectedImage] = useState<InspectedImage | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const portraitUrl = useMemo(() => buildPortraitUrl(avatar), [avatar]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointer(event: MouseEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
    };
  }, [isOpen]);

  async function handleFileSelection(file: File | null) {
    setInlineError(null);
    onStatusChange?.(null, "success");

    if (!file) {
      setSelectedFile(null);
      setSelectedImage(null);
      return;
    }

    if (!acceptedMimeTypes.includes(file.type)) {
      setInlineError("Use a JPG, PNG, or WebP portrait.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setInlineError("Use an image that is 5 MB or smaller.");
      return;
    }

    try {
      const nextImage = await inspectImage(file);

      if (nextImage.width < 900 || nextImage.height < 1100) {
        setInlineError("Use an image at least 900 x 1100 pixels for a crisp frame.");
        return;
      }

      setSelectedFile(file);
      setSelectedImage(nextImage);
    } catch (error) {
      setInlineError(
        error instanceof Error ? error.message : "That image could not be used.",
      );
    }
  }

  async function uploadPortrait() {
    if (!selectedFile) {
      setInlineError("Choose an image first.");
      return;
    }

    setIsUploading(true);
    setInlineError(null);

    try {
      const form = new FormData();
      form.set("file", selectedFile, selectedFile.name);

      const response = await fetch("/api/persona/avatar", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as PersonaSettingsResponse | { error?: string };

      if (!response.ok) {
        throw new Error(("error" in payload && payload.error) || "Unable to upload portrait.");
      }

      onUploaded?.(payload as PersonaSettingsResponse);
      onStatusChange?.("Secretary portrait updated.", "success");
      setSelectedFile(null);
      setSelectedImage(null);
      setIsOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to upload portrait.";
      setInlineError(message);
      onStatusChange?.(message, "error");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div
      ref={popoverRef}
      className={`secretary-portrait-field secretary-portrait-field--${variant}`}
    >
      <div className={`desk-polaroid ${variant === "desk" ? "desk-polaroid--large" : "desk-polaroid--settings"}`}>
        <div className="desk-polaroid-photo">
          {portraitUrl ? (
            <img
              src={portraitUrl}
              alt={`${name} portrait`}
              className="desk-polaroid-image"
            />
          ) : (
            <div className="desk-portrait-placeholder" aria-hidden="true">
              <span className="desk-portrait-halo" />
              <span className="desk-portrait-bust" />
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        className="secretary-portrait-trigger"
        aria-label="Set secretary portrait"
        onClick={() => {
          setInlineError(null);
          setIsOpen((current) => !current);
        }}
      >
        +
      </button>

      {isOpen ? (
        <div className="secretary-portrait-popover">
          <div className="secretary-portrait-popover__copy">
            <p className="secretary-portrait-popover__title">Set portrait</p>
            <p className="secretary-portrait-popover__text">
              Use a centered head-and-shoulders photo with clean lighting for the
              best polaroid crop.
            </p>
          </div>

          <div className="secretary-portrait-rules">
            <span>JPG, PNG, or WebP</span>
            <span>5 MB max</span>
            <span>900 x 1100 px minimum</span>
          </div>

          <label className="secretary-portrait-filefield">
            <span>Portrait image</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                void handleFileSelection(event.target.files?.[0] ?? null);
              }}
            />
          </label>

          {selectedFile ? (
            <p className="secretary-portrait-selection">
              {selectedFile.name}
              {selectedImage
                ? ` · ${selectedImage.width} x ${selectedImage.height} · ${selectedImage.cropHint}`
                : ""}
            </p>
          ) : null}

          {inlineError ? (
            <p className="secretary-portrait-error">{inlineError}</p>
          ) : null}

          <div className="secretary-portrait-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => setIsOpen(false)}
            >
              Close
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={isUploading || !selectedFile}
              onClick={() => {
                void uploadPortrait();
              }}
            >
              {isUploading ? "Uploading..." : "Upload portrait"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
