# Stop recurrence by removing the latest occurrence

A recurrence series stops when the user deletes or archives the latest occurrence that holds the recurrence baton. We chose this implicit lifecycle rule over requiring a separate Stop Recurrence command because it keeps series cleanup aligned with the card the user is already managing, while preserving older occurrences as ordinary board history.
