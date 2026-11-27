import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskDetail } from "@/components/tasks/TaskDetail";
import { SECTIONS, pad } from "@/content/docs";

// The team's tasks on the docs: the same board and task page as the admin,
// in the docs' colours (.docs .tk-scope in docs.css). Here the team moves
// their status, ticks checklists and comments; the owner assigns in the admin.

const SECTION_NUMBER = pad(SECTIONS.length + 1);

/** /tasks: the board, opening on "My tasks" for a team member. */
export function DocsTasks() {
  return (
    <article className="docs-article docs-wide">
      <header className="docs-head">
        <p className="docs-kicker">
          <span className="docs-num">{SECTION_NUMBER}</span>
          Team
        </p>
        <h1>
          Tasks<span className="docs-dot">.</span>
        </h1>
        <p className="docs-lead">What each of us is on. Open a task to see what to do and the guide to follow, tick the checklist, move it along and ask in the comments.</p>
      </header>
      <TaskBoard mode="docs" />
    </article>
  );
}

/** /tasks/<number>: one task. */
export function DocsTask({ number }: { number: number }) {
  return (
    <article className="docs-article docs-wide">
      <TaskDetail number={number} mode="docs" />
    </article>
  );
}
