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

**Related Card**:
An active card on the same board that helps interpret the current card. When the current card has labels, Related Cards share at least one label with it; when it has no labels, Related Cards are the board's most recently updated active cards. AI context uses at most the 20 most recently updated Related Cards.

**Card Title**:
The short name of a card. References to title completion in this context mean Card Title completion, not Board or Column naming.

**Description**:
A Markdown-formatted body of a card that captures the card's main details.

**Comment**:
A Markdown-formatted note attached to a card as part of the card's working context.

**Label**:
A board-scoped marker that can be attached to cards for categorization. A Label has a stable board-scoped color for its name, and labels with the same normalized name on a board should be treated as the same label. UI text may call labels "Tags", but domain language should use Label.
_Avoid_: Tag, Tags

**Inline Completion Suggestion**:
A faint, non-persistent suggestion shown while the user is composing text. It becomes card content only when the user explicitly accepts it, such as by pressing Tab.
_Avoid_: Auto-write, auto-fill

**Completion Fragment**:
The text or Markdown fragment inserted when an Inline Completion Suggestion is accepted. Description and Comment completion fragments may use common Markdown structures, including lists, but stay short.

**Conservative Suggestion**:
An AI suggestion that may use current and related card context, but only when the suggested content is supported by that context. It must not invent unsupported people, dates, conclusions, or requirements.

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

Dev: Should Archived Cards be used as related Cards for AI context?

Domain expert: No. Related Cards are Active Cards only.

Dev: Is a card completed because its status says Done?

Domain expert: No. A card is completed when it belongs to the board's Completion Column.

Dev: After a Recurring Card creates the next Occurrence, is the old card still recurring?

Domain expert: No. The old occurrence becomes an ordinary card after the Recurrence Baton moves to the next occurrence.

Dev: If I edit an old occurrence after it handed off the Recurrence Baton, does that update future occurrences?

Domain expert: No. Only the card currently holding the Recurrence Baton updates the Series Template.

Dev: If 50 Active Cards share a Label with the current Card, are all 50 Related Cards?

Domain expert: They are related in the broad sense, but AI context uses at most the 20 most recently updated Related Cards.

Dev: Are Related Cards sent as title-only references?

Domain expert: No. Related Cards are part of the AI context with their full card information, including Comments and Subtasks.

Dev: If a Card has no Labels, does it have no Related Cards?

Domain expert: It still has Related Cards for AI context: the most recently updated Active Cards on the same Board.

Dev: Can a suggestion invent a plausible deadline if related Cards mention similar work?

Domain expert: No. A Conservative Suggestion can use supported context, but it must not invent unsupported facts.

Dev: Does description completion always have to be one sentence?

Domain expert: No. It is a short Completion Fragment, which may be a sentence, list item, or small Markdown fragment.

Dev: Does a Draft Card have Related Cards by shared Label?

Domain expert: No. A Draft Card has no labels yet, so AI context uses its Board labels and recent Active Cards from its Column instead.