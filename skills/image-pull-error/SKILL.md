---
name: image-pull-error
description: Use when a container cannot start because its image cannot be pulled, shown as a waiting reason of ErrImagePull or ImagePullBackOff, usually on a Pending pod with a restart count of 0.
---

# Image pull error

The container never started, because the node could not download its image.

## How to recognize it

In the pod summary, look at the container:

- `state: "waiting"` and `reason` is `ErrImagePull` or `ImagePullBackOff`.
- `restartCount` is 0, and the pod `phase` is `Pending`.
- `message` holds the error from the registry, with the image name in it.

## What to check next

1. Read the pod's events (`get_events` for the pod). Look for `Failed` and `BackOff` events about pulling the image. They repeat the registry's error.
2. Do not read the logs. The container never ran, so there are none.

## What confirms it

The reason `ErrImagePull` or `ImagePullBackOff`, together with a registry error in the `message` or in the events. Read the registry's words, because they say which of these it is:

| The message says                                    | The cause is                                        |
| --------------------------------------------------- | --------------------------------------------------- |
| `not found`, `manifest unknown`                     | the image or the tag does not exist in the registry |
| `unauthorized`, `authentication required`, `denied` | the registry refused access to the image            |
| `no such host`, `i/o timeout`, `connection refused` | the node cannot reach the registry                  |
| `toomanyrequests`                                   | the registry's pull rate limit was reached          |

## What rules it out, or points elsewhere

- Reason `ContainerCreating`, or an event `FailedScheduling`, means the pod is stuck before the image is pulled. This is not an image problem.
- A restart count above 0 with a reason `CrashLoopBackOff` means the image was pulled and the container ran. Use the crash skills instead.

## What you cannot see

The tools do not show the registry, the pull secrets, or the pod's spec. They cannot tell you whether another tag of the image exists. Say so. Do not guess a corrected image name or tag, even when the name looks like a typo.

## How to report it

Write the entry for this pod with these three lines, and fill in the values from the tools:

```
Cause: the image cannot be pulled: <what the registry error says, in plain words>.
Evidence: reason <reason>, image "<image name from the message>", message "<the registry error>".
Not visible: the registry, the pull secrets and other tags of the image are not visible with the available tools.
```

- Always write all three lines.
- Quote the registry error from the pod summary or the events, and say which of the two it came from.
- Do not propose a corrected image name.
