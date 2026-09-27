# Profile-local worklog JSON import

This localhost demo watches `imports/worklogs/inbox/*.json` beside the selected
profile's `config.json`, at startup and every 10 seconds. It never reads or
writes the production Y: inbox. Write a temporary file and rename it to `.json`
when complete; the scanner also waits at least 0.75 seconds after the last
write. Files are limited to 2 MB and 500 entries. Up to 25 ready files are
handled per scan.

An entry, array, or envelope with `defaults` and `entries` is accepted. Every
entry must identify an existing, visible demo user by `userId`/`erpUserId` or
`userName`/`user`; there is **no default user**. Names match without case or
accents but must be unambiguous. Specify exactly one numeric duration field:
`hours`, `durationHours`, `minutes`, `durationMinutes`, `seconds`,
`durationSeconds`, `milliseconds`, or `durationMilliseconds`. It must round
to more than zero and at most 24 hours. `workDate`/`date`, `workType`/`activity`,
`note`/`description`, start/end timestamps, `source`, and `externalId`/`id`
are optional. The current work types are mirrored to `imports/worklogs/worktypes.json`;
when replaced, the previous version is first copied to `worktypes-history`.

Example for the generic profile:

```json
{
  "source": "sample-tracker",
  "defaults": { "userId": "demo-user", "workType": "Design" },
  "entries": [
    { "projectId": "demo-project-a", "minutes": 90, "workDate": "2026-09-26", "externalId": "sample-1" }
  ]
}
```

Unknown projects do not create or reactivate a project. They import without a
project and receive a note for manual assignment. `overtime: true` is retained
only for users listed in the profile's `overtimeUserIds`; other users' time
imports normally. A repeated `source` + `externalId`, or identical file entry,
is skipped. Valid entries are committed even when other entries in the file
fail. Rejected entries go to `failed/` with an error text; envelope `defaults`
are preserved. Every original file moves to `processed/` after processing,
including successful and mixed batches. Invalid whole files move to `failed/`.
Nothing is silently deleted; archived files are left for the profile owner.
