import type { JobFormState } from "../jobs-console";

type JobFormPanelProps = {
  form: JobFormState;
  isCreating: boolean;
  onUpdateForm: <K extends keyof JobFormState>(key: K, value: JobFormState[K]) => void;
  onCreateJob: () => void;
};

export function JobFormPanel({ form, isCreating, onUpdateForm, onCreateJob }: JobFormPanelProps) {
  return (
    <div className="jobs-create-grid">
      <label className="jobs-field">
        <span className="jobs-field__label">Title</span>
        <input
          value={form.title}
          onChange={(event) => onUpdateForm("title", event.target.value)}
          className="input-shell"
        />
      </label>

      <label className="jobs-field">
        <span className="jobs-field__label">Workspace</span>
        <input
          value={form.workspacePath}
          onChange={(event) => onUpdateForm("workspacePath", event.target.value)}
          className="input-shell"
        />
      </label>

      <div className="jobs-create-grid__action">
        <button
          type="button"
          onClick={onCreateJob}
          disabled={
            isCreating || !form.goal.trim() || !form.workspacePath.trim() || !form.title.trim()
          }
          className="button-primary"
        >
          {isCreating ? "Starting job..." : "Start agent job"}
        </button>
      </div>

      <label className="jobs-field jobs-field--goal">
        <span className="jobs-field__label">Goal</span>
        <textarea
          value={form.goal}
          onChange={(event) => onUpdateForm("goal", event.target.value)}
          className="textarea-shell"
          rows={3}
          placeholder="Describe what the agent should build or change."
        />
      </label>

      <label className="jobs-field">
        <span className="jobs-field__label">Constraints</span>
        <textarea
          value={form.constraintsText}
          onChange={(event) => onUpdateForm("constraintsText", event.target.value)}
          className="textarea-shell"
          rows={3}
          placeholder="One constraint per line."
        />
      </label>

      <label className="jobs-field">
        <span className="jobs-field__label">Deliverables</span>
        <textarea
          value={form.deliverablesText}
          onChange={(event) => onUpdateForm("deliverablesText", event.target.value)}
          className="textarea-shell"
          rows={3}
          placeholder="One deliverable per line."
        />
      </label>
    </div>
  );
}
