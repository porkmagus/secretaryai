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

export const secretaryModes: Array<{ value: SecretaryMode; label: string }> = [
  { value: "workday", label: "Workday" },
  { value: "personal", label: "Personal" },
  { value: "travel", label: "Travel" },
  { value: "deep_focus", label: "Deep focus" },
  { value: "operator", label: "Operator" },
];

export const relationshipRoles: Array<{ value: SecretaryRelationshipRole; label: string }> = [
  { value: "private_secretary", label: "Private secretary" },
  { value: "chief_of_staff", label: "Chief of staff" },
  { value: "operator", label: "Operator" },
  { value: "companion", label: "Companion in the work" },
  { value: "household_coordinator", label: "Household coordinator" },
];

export const presenceStyles: Array<{ value: SecretaryPresenceStyle; label: string }> = [
  { value: "composed", label: "Composed" },
  { value: "warm", label: "Warm" },
  { value: "playful", label: "Playful" },
  { value: "formal", label: "Formal" },
  { value: "assertive", label: "Assertive" },
];

export const responseLengths: Array<{ value: SecretaryResponseLength; label: string }> = [
  { value: "concise", label: "Concise" },
  { value: "balanced", label: "Balanced" },
  { value: "expansive", label: "Expansive" },
];

export const directnessOptions: Array<{ value: SecretaryDirectness; label: string }> = [
  { value: "soft", label: "Soft" },
  { value: "balanced", label: "Balanced" },
  { value: "direct", label: "Direct" },
];

export const initiativeOptions: Array<{ value: SecretaryInitiative; label: string }> = [
  { value: "reactive", label: "Reactive" },
  { value: "balanced", label: "Balanced" },
  { value: "proactive", label: "Proactive" },
];

export const planningStyles: Array<{ value: SecretaryPlanningStyle; label: string }> = [
  { value: "checklist", label: "Checklist" },
  { value: "narrative", label: "Narrative" },
  { value: "executive", label: "Executive" },
];

export const greetingStyles: Array<{ value: SecretaryGreetingStyle; label: string }> = [
  { value: "minimal", label: "Minimal" },
  { value: "name_forward", label: "Name-forward" },
  { value: "warm", label: "Warm" },
];

export const closingStyles: Array<{ value: SecretaryClosingStyle; label: string }> = [
  { value: "none", label: "None" },
  { value: "next_steps", label: "Next steps" },
  { value: "summary", label: "Summary" },
];

export const clarifyingStyles: Array<{ value: SecretaryClarifyingStyle; label: string }> = [
  { value: "sparing", label: "Sparing" },
  { value: "balanced", label: "Balanced" },
  { value: "proactive", label: "Proactive" },
];

export const reminderStyles: Array<{ value: SecretaryReminderStyle; label: string }> = [
  { value: "gentle", label: "Gentle" },
  { value: "balanced", label: "Balanced" },
  { value: "firm", label: "Firm" },
];
