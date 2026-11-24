---
name: oomkilled
description: Use when a container was killed for running out of memory, shown as a last termination reason of OOMKilled or exit code 137, including pods whose current state says CrashLoopBackOff.
---

# OOMKilled

The container used more memory than its limit, and the kernel killed it.

## How to recognize it

In the pod summary, look at the container:

- `lastReason: "OOMKilled"` (the previous run ended this way), or `reason: "OOMKilled"` if the container is terminated right now.
- `lastExitCode` or `exitCode` is 137.
- `restartCount` is above 0.

Trust the termination reason, not the current state. A pod that keeps being killed usually shows `CrashLoopBackOff` or `waiting` as its state, and the OOM is only in the last termination.

## What to check next

1. Always read the logs of the previous run, before you report: call the logs tool with `previous: true`. A container killed for memory usually prints nothing about it, so the log often just stops. Note what the last lines say the container was doing (loading a model, processing a large file). The report needs this line.
2. Optionally read the pod's events. They confirm the restart loop (`BackOff`), but they usually do not mention memory.

## What confirms it

The reason `OOMKilled` is the confirmation of the cause. The cluster itself recorded that the container was killed for memory, so no log line is needed to prove it. You still read the logs (see above), because the report includes what the container was doing.

## What rules it out, or points elsewhere

- Exit code 137 with a reason that is not `OOMKilled` means something else killed the container, for example a failed health check or the node. Check the events for `Killing` or `Unhealthy`, and do not report a memory problem.
- Reason `Error` with exit code 1 is an application crash, not a memory kill. The logs hold the cause.

## What you cannot see

The tools do not show the container's memory limit or its actual usage. Say so. Do not invent a number.

## How to report it

Write the entry for this pod with these three lines, and fill in the values from the tools:

```
Cause: the container was killed for exceeding its memory limit.
Evidence: reason OOMKilled, exit code 137, restart count <number>, last log line "<line>".
Not visible: the memory limit and the actual usage are not visible with the available tools.
```

- Always write all three lines. The last line is required in every report, even if the rest is short.
- If the log is empty, or the tool could not read it (for example "unable to retrieve container logs"), that text is not a log line. Write `logs empty` or `logs could not be read ("<the tool's error>")` in the Evidence line, in place of `last log line "<line>"`. The Cause line stays the same, because the reason `OOMKilled` confirms it.
- Do not recommend a new limit.
