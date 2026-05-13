import type {
  SecretaryClarifyingStyle,
  SecretaryClosingStyle,
  SecretaryDirectness,
  SecretaryGreetingStyle,
  SecretaryInitiative,
  SecretaryMode,
  SecretaryPlanningStyle,
  SecretaryPresenceStyle,
  SecretaryRelationshipRole,
  SecretaryReminderStyle,
  SecretaryResponseLength,
} from "@secretary/core-runtime";
import type { Dispatch, SetStateAction } from "react";
import { FieldHint as FieldNote, SurfaceCard } from "../lib/ui";
import type { PersonaDraft } from "./persona-console";
import {
  clarifyingStyles,
  closingStyles,
  directnessOptions,
  greetingStyles,
  initiativeOptions,
  planningStyles,
  presenceStyles,
  relationshipRoles,
  reminderStyles,
  responseLengths,
  secretaryModes,
} from "./persona-constants";

interface PersonaWritingSectionProps {
  draft: PersonaDraft | null;
  setDraft: Dispatch<SetStateAction<PersonaDraft | null>>;
  downloadText: (filename: string, text: string) => void;
  buildSecretaryExamplesMarkdown: (draft: PersonaDraft) => string;
}

export function PersonaWritingSection({
  draft,
  setDraft,
  downloadText,
  buildSecretaryExamplesMarkdown,
}: PersonaWritingSectionProps) {
  return (
    <>
      <SurfaceCard
        title="Presence and posture"
        description={
          <p>
            How the secretary should show up, take initiative, and frame the relationship before a
            single reply is written.
          </p>
        }
        className="stack-md"
      >
        <div className="persona-identity-row">
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Mode</span>
            <select
              value={draft?.mode ?? "workday"}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, mode: event.target.value as SecretaryMode } : current,
                )
              }
            >
              {secretaryModes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Sets the secretary&apos;s overall operating context, so the same persona can feel
              different during work, travel, or deep-focus sessions.
            </FieldNote>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Relationship</span>
            <select
              value={draft?.relationshipRole ?? "private_secretary"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        relationshipRole: event.target.value as SecretaryRelationshipRole,
                      }
                    : current,
                )
              }
            >
              {relationshipRoles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Defines the role posture the model should adopt when it decides how to help, lead, or
              follow.
            </FieldNote>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Presence</span>
            <select
              value={draft?.presenceStyle ?? "composed"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, presenceStyle: event.target.value as SecretaryPresenceStyle }
                    : current,
                )
              }
            >
              {presenceStyles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Controls the emotional texture of replies: composed, warmer, more formal, more
              playful, or more forceful.
            </FieldNote>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Initiative</span>
            <select
              value={draft?.initiative ?? "balanced"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, initiative: event.target.value as SecretaryInitiative }
                    : current,
                )
              }
            >
              {initiativeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Decides how often the secretary should volunteer next steps, reminders, or useful
              nudges without waiting to be asked.
            </FieldNote>
          </label>
        </div>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="persona-file-label-row">
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Optional title</span>
          </span>
          <input
            value={draft?.title ?? ""}
            onChange={(event) =>
              setDraft((current) => (current ? { ...current, title: event.target.value } : current))
            }
            placeholder="Chief of Staff, Private Secretary, Studio Operator..."
            style={{ maxWidth: 420 }}
          />
          <FieldNote>
            Use a title only if you want the secretary to occasionally identify herself with a role
            beyond her name.
          </FieldNote>
        </label>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
          These controls are fed into the live model instructions, so they change both the feel of
          model-backed replies and the fallback guidance.
        </p>
      </SurfaceCard>

      <SurfaceCard
        title="Habits and preferences"
        description={
          <p>
            Compact habits that change how replies are phrased, structured, and delivered turn after
            turn.
          </p>
        }
        className="stack-md"
      >
        <div className="persona-identity-row">
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Reply length</span>
            <select
              value={draft?.responseLength ?? "balanced"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, responseLength: event.target.value as SecretaryResponseLength }
                    : current,
                )
              }
            >
              {responseLengths.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Shapes how much the secretary says before she stops, from clipped answers to fuller,
              more developed replies.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Directness</span>
            <select
              value={draft?.directness ?? "balanced"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, directness: event.target.value as SecretaryDirectness }
                    : current,
                )
              }
            >
              {directnessOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Tunes whether the secretary sounds gentler, balanced, or blunt when she gives an
              answer or correction.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Planning style</span>
            <select
              value={draft?.planningStyle ?? "executive"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, planningStyle: event.target.value as SecretaryPlanningStyle }
                    : current,
                )
              }
            >
              {planningStyles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Guides whether plans come back as checklists, narrative guidance, or crisp
              executive-style summaries.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Reminder tone</span>
            <select
              value={draft?.reminderStyle ?? "gentle"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, reminderStyle: event.target.value as SecretaryReminderStyle }
                    : current,
                )
              }
            >
              {reminderStyles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Controls how reminders and nudges should feel when the secretary follows up on pending
              work.
            </FieldNote>
          </label>
        </div>

        <div className="persona-identity-row">
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Greeting habit</span>
            <select
              value={draft?.greetingStyle ?? "minimal"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, greetingStyle: event.target.value as SecretaryGreetingStyle }
                    : current,
                )
              }
            >
              {greetingStyles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Decides whether replies open with no greeting, your name, or a softer, warmer lead-in.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Closing habit</span>
            <select
              value={draft?.closingStyle ?? "next_steps"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, closingStyle: event.target.value as SecretaryClosingStyle }
                    : current,
                )
              }
            >
              {closingStyles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Tells the secretary whether to end cleanly, summarize, or naturally point toward the
              next step.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Clarifying questions</span>
            <select
              value={draft?.clarifyingStyle ?? "sparing"}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        clarifyingStyle: event.target.value as SecretaryClarifyingStyle,
                      }
                    : current,
                )
              }
            >
              {clarifyingStyles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldNote>
              Sets how eager the secretary should be to ask follow-up questions before acting or
              answering.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Address preference</span>
            <input
              value={draft?.addressPreference ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, addressPreference: event.target.value } : current,
                )
              }
              placeholder="Preferred form of address for the user"
            />
            <FieldNote>
              If you want a stable form of address, set it here and the secretary can use it
              naturally in greetings and warmer replies.
            </FieldNote>
          </label>
        </div>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
          Use this row for durable habits. Save one-off wording or richer demonstrations for the
          examples section below.
        </p>
      </SurfaceCard>

      <SurfaceCard
        title="Boundaries and examples"
        description={
          <p>
            Tell the secretary what to avoid, then anchor the voice with one good example and one
            answer to avoid.
          </p>
        }
        className="stack-md"
      >
        <div className="persona-file-label-row">
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Download companion file</span>
          <button
            type="button"
            className="persona-file-pill"
            onClick={() =>
              draft && downloadText("secretary-examples.md", buildSecretaryExamplesMarkdown(draft))
            }
            disabled={!draft}
          >
            secretary-examples.md
          </button>
        </div>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Avoidances (one per line)</span>
          <textarea
            value={draft?.avoidancesText ?? ""}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, avoidancesText: event.target.value } : current,
              )
            }
            rows={4}
            style={{
              borderRadius: 16,
              border: "1px solid var(--field-border)",
              background: "var(--field-bg)",
              color: "var(--text)",
              padding: 16,
              font: "inherit",
              resize: "vertical",
            }}
          />
          <FieldNote>
            List habits, tones, or behaviors the secretary should actively avoid, one line at a
            time.
          </FieldNote>
        </label>
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Good example reply</span>
            <textarea
              value={draft?.exampleReply ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, exampleReply: event.target.value } : current,
                )
              }
              rows={4}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
            <FieldNote>
              Give one reply that feels exactly right so the secretary has a concrete target to
              imitate.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Reply to avoid</span>
            <textarea
              value={draft?.antiExampleReply ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, antiExampleReply: event.target.value } : current,
                )
              }
              rows={4}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
            <FieldNote>
              Give one reply that feels wrong so the secretary learns the line she should not cross.
            </FieldNote>
          </label>
        </div>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
          This companion export mirrors the current boundaries and examples block into one markdown
          file for documentation and tuning.
        </p>
      </SurfaceCard>

      <SurfaceCard
        title="Soul and behavior"
        description={
          <p>
            The markdown-backed soul, persona profile, and guardrails that shape the
            secretary&apos;s deeper voice.
          </p>
        }
        className="stack-md"
      >
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span className="persona-file-label-row">
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Secretary soul</span>
              <button
                type="button"
                className="persona-file-pill"
                onClick={() => draft && downloadText("secretary-soul.md", draft.promptTemplate)}
                disabled={!draft}
              >
                secretary-soul.md
              </button>
            </span>
            <textarea
              value={draft?.promptTemplate ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, promptTemplate: event.target.value } : current,
                )
              }
              rows={7}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
            <FieldNote>
              This is the deepest framing file for the secretary: the enduring voice, posture, and
              private internal instructions she should carry.
            </FieldNote>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="persona-file-label-row">
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Persona profile</span>
              <button
                type="button"
                className="persona-file-pill"
                onClick={() => draft && downloadText("secretary-persona.md", draft.personaProfile)}
                disabled={!draft}
              >
                secretary-persona.md
              </button>
            </span>
            <textarea
              value={draft?.personaProfile ?? ""}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, personaProfile: event.target.value } : current,
                )
              }
              rows={8}
              style={{
                borderRadius: 16,
                border: "1px solid var(--field-border)",
                background: "var(--field-bg)",
                color: "var(--text)",
                padding: 16,
                font: "inherit",
                resize: "vertical",
              }}
            />
            <FieldNote>
              This file is the lived texture of the secretary: identity, voice, posture, and the
              kind of person she should feel like in use.
            </FieldNote>
          </label>
        </div>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>
          The soul holds the deeper framing. The persona profile carries the lived texture. Saving
          writes both the live markdown-backed files and the stored settings together.
        </p>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Behavior rules (one per line)</span>
          <textarea
            value={draft?.behaviorRulesText ?? ""}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, behaviorRulesText: event.target.value } : current,
              )
            }
            rows={5}
            style={{
              borderRadius: 16,
              border: "1px solid var(--field-border)",
              background: "var(--field-bg)",
              color: "var(--text)",
              padding: 16,
              font: "inherit",
              resize: "vertical",
            }}
          />
          <FieldNote>
            Keep these short, durable, and operational. They work best as a clean list of high-value
            guardrails rather than a second persona essay.
          </FieldNote>
        </label>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Keep this tight and durable. The shorter this stays, the easier it is to maintain.
        </p>
      </SurfaceCard>
    </>
  );
}
