# Skills

Runbooks the agents load **only when relevant**. Each skill is a folder with a `SKILL.md`:

```
skills/
  crashloop-backoff/SKILL.md
  oomkilled/SKILL.md
  image-pull-error/SKILL.md
```

Nothing here yet: skills arrive in Milestone 2, when Triage can pick one per hypothesis. The reason for loading them
on demand rather than putting every runbook in every prompt is context cost: an agent investigating an OOMKill has no
use for the image-pull runbook.
