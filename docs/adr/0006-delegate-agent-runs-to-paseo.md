# Delegate agent runs to Paseo

Agent Runs should delegate provider selection, worktree creation, branch management, execution, and logs to Paseo instead of managing those concerns inside Kanban. We chose this boundary because Paseo already exposes provider discovery, detached runs, managed worktrees, logs, attach, and wait commands, while keeping those responsibilities in Kanban would duplicate execution orchestration and make provider-specific behavior part of the board app.
