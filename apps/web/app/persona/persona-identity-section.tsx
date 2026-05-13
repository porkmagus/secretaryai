import type { PersonaGender, PersonaSettingsResponse } from "@secretary/core-runtime";
import type { Dispatch, SetStateAction } from "react";
import { SecretaryPortraitField } from "../lib/secretary-portrait-field";
import { FieldHint as FieldNote, SurfaceCard } from "../lib/ui";

type PersonaDraft = {
  addressPreference: string;
  antiExampleReply: string;
  avoidancesText: string;
  behaviorRulesText: string;
  clarifyingStyle: any;
  closingStyle: any;
  directness: any;
  gender: PersonaGender;
  greetingStyle: any;
  initiative: any;
  mode: any;
  name: string;
  personaProfile: string;
  presenceStyle: any;
  relationshipRole: any;
  reminderStyle: any;
  responseLength: any;
  title: string;
  promptTemplate: string;
  toneMode: string;
  voiceProfileId: string;
  exampleReply: string;
  planningStyle: any;
};

interface PersonaIdentitySectionProps {
  data: PersonaSettingsResponse | null;
  draft: PersonaDraft | null;
  setDraft: Dispatch<SetStateAction<PersonaDraft | null>>;
  handlePortraitResponse: (next: PersonaSettingsResponse) => void;
  handlePortraitStatus: (message: string | null, tone: "error" | "success") => void;
}

export function PersonaIdentitySection({
  data,
  draft,
  setDraft,
  handlePortraitResponse,
  handlePortraitStatus,
}: PersonaIdentitySectionProps) {
  return (
    <SurfaceCard
      title="Identity basics"
      description={
        <p>
          The short identity fields that shape the secretary before the long-form writing takes
          over.
        </p>
      }
      className="stack-md"
    >
      <div className="persona-identity-grid">
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Portrait</span>
          <SecretaryPortraitField
            avatar={data?.persona.avatar}
            name={draft?.name ?? data?.persona.name ?? "SetAgentName"}
            variant="settings"
            onUploaded={handlePortraitResponse}
            onStatusChange={handlePortraitStatus}
          />
          <FieldNote>
            Use a centered portrait with a clean face crop so it reads well in the polaroid frame on
            Desk.
          </FieldNote>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            alignContent: "start",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Name</span>
            <input
              value={draft?.name ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              style={{
                borderRadius: 12,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: "10px 12px",
                font: "inherit",
                maxWidth: 280,
              }}
              placeholder="SetAgentName"
            />
            <FieldNote>
              This is the public identity shown on Desk, in chat headers, and across settings.
            </FieldNote>
          </label>

          <div className="persona-identity-row">
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Gender</span>
              <select
                value={draft?.gender ?? "female"}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, gender: event.target.value as PersonaGender } : current,
                  )
                }
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
              <FieldNote>
                Sets the default presentation seed used for voice/profile defaults when nothing more
                specific is configured.
              </FieldNote>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Tone mode</span>
              <input
                value={draft?.toneMode ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, toneMode: event.target.value } : current,
                  )
                }
                placeholder="calm"
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              />
              <FieldNote>
                A short internal mood tag for the secretary, like <code>calm</code>,{" "}
                <code>sharp</code>, or <code>warm</code>.
              </FieldNote>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Voice profile</span>
              <select
                value={draft?.voiceProfileId ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, voiceProfileId: event.target.value } : current,
                  )
                }
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--field-border)",
                  background: "var(--field-bg)",
                  color: "var(--text)",
                  padding: "10px 12px",
                  font: "inherit",
                }}
              >
                <option value="">No voice profile selected</option>
                {(data?.voiceProfiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                    {profile.isActive ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}
