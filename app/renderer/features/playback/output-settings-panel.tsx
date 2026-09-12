import { OutputControls } from './output-controls';

export function OutputSettingsPanel() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 border-b border-primary pb-5">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-primary">Audience screen</h2>
        </header>
        <p className="text-sm text-tertiary">System display output is not wired yet.</p>
      </section>

      <OutputControls name="audience" />
      <OutputControls name="stage" />

      <p className="text-sm text-tertiary">
        Live diagnostics, frame stats, log viewer, and process metrics moved to the Observability tab.
      </p>
    </div>
  );
}
