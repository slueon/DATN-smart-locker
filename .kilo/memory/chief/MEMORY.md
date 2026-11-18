# Memory

- The user treats docs the Bot authored (e.g. MQTT_GUIDE.md) as the Bot's own and won't edit them personally, so the Bot should make needed corrections itself.
- The user objected that the Chief did phases 0 and 1 alone: they expect substantial work to be assigned to the team's bots, not done solo, and each bot's own output to be independently verified rather than self-approved.
- The user controls when Smart Locker team work runs: they halt everything mid-work and it stays stopped until they say to continue (e.g. 'tiếp tục làm tiếp'), so nothing is restarted on the team's own initiative.
- The user prefers the Bot to start the project's services itself and hand over working links (with proof they run), rather than instructions for the user to run them manually.
- The user often reboots or shuts down their computer between work sessions, which kills all running servers and Chrome; when work resumes, running processes and ports must be re-checked and the services restarted before verifying anything.
- The user wants every memory entry, new or changed, written in English from now on.
- The user prefers the Bot to go ahead and fix a real bug it has found rather than stop and ask permission ('bạn sửa luôn đi'); the exception is a run-and-test round, where bugs are only reported — test every feature, write failures to STATE.md, and wait for a separate go-ahead before fixing anything.
- The user lowered the Chief's solo-work threshold to 7 minutes (from 15): the Chief works alone only on tasks under 7 minutes and delegates longer work to the team's bots, and even a small fix done solo must be accepted by a team bot, never self-approved.
- The user runs the Bot on their own API key; when a turn fails with an API/quota error, the cause is on their account's model/key side, not the Bot's work. (The model in use has changed over time, so the current model name should be confirmed rather than assumed.)
- When work is finished the Bot only commits and pushes: it never stops the servers (backend 8080 / vite 5173) and never shuts down the user's machine unless the user explicitly asks in the prompt, leaving the project running for the user to view.
- The user wants answers kept short and brief — plain prose (văn xuôi) rather than tables, bullet-heavy breakdowns, or long explanations.
- The user expects every real bug the Chief diagnoses to be written into STATE.md as a card straight away, instead of being left at the diagnosis stage while the user is asked to pick a fix direction (e.g. A/B/C).
- When a card's target fails, the user prefers fixing the root cause (e.g. making the MQTT publish asynchronous instead of a ~1.9s synchronous call inside the transaction) over widening a test threshold to make it pass.
- When one thing changes in a project, the user expects every stale reference to it fixed in the same pass (UI labels, backend messages, tests, comments, README), not just the one place he pointed at ('có hãy sửa lại hết').
- When a team round ends in FAIL and cannot continue, the user still wants the computer shut down as on success (reason written to STATE.md, no commit, notification sent), then the work resumes the next day.

## Index
- [[project]]
- [[tooling]]
- [[smart-locker]]
- [[team-workflow]]
- [[docx]]
- [[smart-locker-mqtt]]
