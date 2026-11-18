# team-workflow

- The user finds the team bots too slow even on a simple request and wants their configuration and instructions kept lean (e.g. STATE.md context bloat, duplicated measurement scripts); he also wants progress reports when a round runs unusually long.
- When the team bots' model calls fail with provider-side errors (e.g. KVTransferError), the user chooses to wait and retry later rather than switch sóc and minh to another model.
- The user attributes the slowness of the team's bots (sóc, minh, running deepseek-v4.1-flash) to DeepSeek API latency, and session-log measurements back it: 60–80% of a round is spent waiting on model responses, only ~20–40% running tools.
- The user chose to speed up the team bots by keeping STATE.md lean (only the phases still running, a 'DỮ LIỆU CHUẨN' section at the top, the rest moved to ARCHIVE.md) and by building a reusable test/measure script library in scripts/lib/, with sóc and minh starting a fresh session for each phase.
