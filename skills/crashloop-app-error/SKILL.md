---
name: crashloop-app-error
description: Use when a container keeps crashing on its own, shown as CrashLoopBackOff or a terminated state with a last reason of Error and an exit code such as 1, and not as OOMKilled or an image problem.
---

# Application crash

The application inside the container exits with an error, and Kubernetes keeps restarting it. The cause is whatever the application printed before it exited.

## How to recognize it

In the pod summary, look at the container:

- `reason: "CrashLoopBackOff"` (state `waiting`), or state `terminated` with `reason: "Error"`.
- `lastReason: "Error"` and `lastExitCode` is not 0 and not 137 (for example 1 or 2).
- `restartCount` is above 0.

## What to check next

1. Read the logs of the previous run: call the logs tool with `previous: true`. The current container is waiting to restart, so only the previous run has the error.
2. Read the last lines. The cause is usually printed there: a line with `FATAL`, `error`, `exception`, or a message that a value is not set.
3. Optionally read the pod's events. They show `BackOff`, which confirms the restart loop, and they do not give the cause.

## What confirms it

A log line from the crashed run that states the error. That line is the cause. An exit code alone is not a cause.

## What rules it out, or points elsewhere

- `lastReason: "OOMKilled"` or exit code 137 is a memory kill. Use the OOMKilled skill.
- A reason `ErrImagePull` or `ImagePullBackOff` is an image problem. The container never ran.
- If the logs cannot be read (the tool returns "unable to retrieve container logs", or an empty result), you do not know the cause. Say so. Do not turn the exit code into a cause, and do not guess from the pod's name.

## What you cannot see

The tools do not show the pod's environment variables, config maps, secrets or spec. A log line that says a value "is not set" tells you what the application complained about, but not how the pod is configured. Say so. Do not say which config map or secret is missing.

## How to report it

Write the entry for this pod with these three lines, and fill in the values from the tools:

```
Cause: <what the log line says, in plain words>.
Evidence: reason <reason>, exit code <number>, restart count <number>, last log line "<line>".
Not visible: the pod's environment, config and secrets are not visible with the available tools.
```

- Always write all three lines.
- If the log is empty, or the tool could not read it (for example "unable to retrieve container logs"), that text is not a log line. Write `Cause: not determined: the logs could not be read.` In the Evidence line, write `logs empty` or `logs could not be read ("<the tool's error>")` in place of `last log line "<line>"`.
- Do not recommend a fix.
