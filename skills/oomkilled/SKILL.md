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

1. Read the logs of the previous run: call the logs tool with `previous: true`. A container killed for memory usually prints nothing about it, so the log often just stops. Note what the last lines say the container was doing (loading a model, processing a large file).
2. Optionally read the pod's events. They confirm the restart loop (`BackOff`), but they usually do not mention memory.

## What confirms it

The reason `OOMKilled` is the confirmation. The cluster itself recorded that the container was killed for memory, so no log line is needed.

## What rules it out, or points elsewhere

- Exit code 137 with a reason that is not `OOMKilled` means something else killed the container, for example a failed health check or the node. Check the events for `Killing` or `Unhealthy`, and do not report a memory problem.
- Reason `Error` with exit code 1 is an application crash, not a memory kill. The logs hold the cause.

## What you cannot see

The tools do not show the container's memory limit or its actual usage. Say so. Do not invent a number.

## How to report it

- Cause: the container was killed for exceeding its memory limit.
- Evidence: the reason `OOMKilled`, the exit code 137, the restart count, and the last log line if it shows what the container was doing.
- Say that the limit and the usage are not visible with the available tools.
- Do not recommend a new limit.
