# Kanban

This context describes the language of a personal kanban board application for organizing work into boards, columns, cards, and labels.

## Language

**Board**:
A workspace that contains columns, cards, and labels for one area of planning.

**Recurring Card**:
A card that currently carries the active recurrence baton for a recurrence series and can lead to future occurrences.
_Avoid_: Task, Timed task

**Recurrence Series**:
A sequence of related cards governed by one recurrence rule.

**Blocked Recurrence Series**:
A recurrence series that still exists but cannot create its next occurrence until the board or rule is corrected.

**Recurrence Rule**:
The trigger mode and cycle that determine when a recurrence series creates occurrences.

**Series Template**:
The work definition used by a recurrence series to create future occurrences. Changes to the recurring card's work definition update the series template, while execution state does not carry forward.

**Recurrence Baton**:
The active recurrence responsibility held by the latest occurrence in a recurrence series.

**Occurrence**:
A card generated from a recurring card for one scheduled cycle. An occurrence becomes an ordinary card after it hands off the recurrence baton to the next occurrence.

**Occurrence Date**:
The date an occurrence represents within its recurrence series.

**Latest Occurrence**:
The occurrence in a recurrence series with the latest occurrence date.

**Column**:
A lane within a board that represents a card's current stage or grouping. A board has many columns, and each card belongs to one column.

**Completion Column**:
The column on a board that represents completed work. A card is completed when it belongs to the board's completion column.
_Avoid_: Done status

**Card**:
An individual work item on a board. A card belongs to one board and one column, and it may have many labels.

**Draft Card**:
A card being composed before it has been created. A Draft Card has a board and column context, but it does not yet have its own labels, comments, or persisted card identity.

**Active Card**:
A card that is still part of the board's current work context.

**Archived Card**:
A card that has been removed from the board's current work context without being deleted.

**Card Title**:
The short name of a card. References to title completion in this context mean Card Title completion, not Board or Column naming.

**Card Binding**:
An external resource attached to a card because it is part of that card's work context. A Git repository path is a Card Binding; it is not an Agent Provider setting or an Agent Run input.
_Avoid_: Agent repository, run repository

**Description**:
A Markdown-formatted body of a card that captures the card's main details.

**Comment**:
A Markdown-formatted note attached to a card as part of the card's working context.

**Agent Run**:
A request from a card to have an external coding agent work on that card and report back into the card's working context. An Agent Run is prompted with the card's requirement context, not repository execution context, and reports by adding a start Comment and a best-effort finish Comment; it does not continuously stream progress into Comments.
_Avoid_: Agent task, execution job

**Agent Run Recovery**:
A best-effort attempt to complete an Agent Run's card reporting after Kanban regains the ability to observe the external agent. Recovery exists to preserve the card's working context, not to guarantee the external agent's outcome.
_Avoid_: Replay, guaranteed completion

**Agent Run Requirement Context**:
The card-derived requirement information sent to an Agent Run. It begins with `/goal`, includes the Card Title as the requirement title, Subtasks, and human-written Comments, and excludes the Description and prior Agent Run Comments.
_Avoid_: Repository context, execution context

**Agent Provider**:
An available external coding agent option selected for an Agent Run.
_Avoid_: Agent binary, CLI command

**Label**:
A board-scoped marker that can be attached to cards for categorization. A Label has a stable board-scoped color for its name, and labels with the same normalized name on a board should be treated as the same label. UI text may call labels "Tags", but domain language should use Label.
_Avoid_: Tag, Tags

**Inline Completion Suggestion**:
A faint, non-persistent suggestion shown while the user is composing text. It becomes card content only when the user explicitly accepts it, such as by pressing Tab.
_Avoid_: Auto-write, auto-fill

**Completion Fragment**:
The text or Markdown fragment inserted when an Inline Completion Suggestion is accepted. Description and Comment completion fragments may use common Markdown structures, including lists, but stay short.

**Conservative Suggestion**:
An AI suggestion that may use the current card context and any board-scoped constraints needed to keep the suggestion valid, but only when the suggested content is supported by that context. It must not invent unsupported people, dates, conclusions, or requirements.

**Suggestion Profile**:
A named set of style and generation-policy constraints that guides an Inline Completion Suggestion. Tone is one part of a Suggestion Profile, not the whole profile.

## Example Dialogue

Dev: When a user clicks "Add tag" in the card details panel, should we create a Tag?

Domain expert: No. In the domain model that creates or attaches a Label; "Tags" is only the UI wording.

Dev: Can the same Label be attached to multiple Cards on a Board?

Domain expert: Yes. A Label belongs to one Board and may be attached to many Cards on that Board.

Dev: If an Inline Completion Suggestion appears while I type a Card title, has the Card changed?

Domain expert: No. The Card changes only after the user accepts the suggestion or types the text themselves.

Dev: Should title completion rename a Board or Column?

Domain expert: No. Title completion applies to Card Titles only.

Dev: Are Comments part of a Card's context when asking for an Inline Completion Suggestion?

Domain expert: Yes. Comments are part of the Card's working context.

Dev: Should an Inline Completion Suggestion use other Cards on the Board as context?

Domain expert: No. It should stay grounded in the current Card. Board-scoped constraints such as existing Labels may be included only when needed to keep the suggestion valid.

Dev: Is a card completed because its status says Done?

Domain expert: No. A card is completed when it belongs to the board's Completion Column.

Dev: After a Recurring Card creates the next Occurrence, is the old card still recurring?

Domain expert: No. The old occurrence becomes an ordinary card after the Recurrence Baton moves to the next occurrence.

Dev: If I edit an old occurrence after it handed off the Recurrence Baton, does that update future occurrences?

Domain expert: No. Only the card currently holding the Recurrence Baton updates the Series Template.

Dev: Can a suggestion invent a plausible deadline if related Cards mention similar work?

Domain expert: No. A Conservative Suggestion can use supported context, but it must not invent unsupported facts.

Dev: Is '简洁务实' only a tone choice?

Domain expert: No. That is a Suggestion Profile. Tone is only one part of it, alongside generation-policy constraints such as how conservative the suggestion should be.

Dev: Does description completion always have to be one sentence?

Domain expert: No. It is a short Completion Fragment, which may be a sentence, list item, or small Markdown fragment.

Dev: Does a Draft Card still have enough context for an Inline Completion Suggestion?

Domain expert: Yes. A Draft Card can still use its own draft content and any board-scoped constraints needed to keep the suggestion valid.
