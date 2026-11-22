# k8s-war-room

## The problem

When a pod breaks in Kubernetes, the engineer on call has to find out why. That means checking several places and
putting the evidence together: the pod's state, its logs, the cluster events, sometimes a web search for the error.
For example, `checkout` shows `Error` and its logs say `DATABASE_URL is not set`, while `recommender` shows
`CrashLoopBackOff` but was really `OOMKilled`, which only the last termination state reveals.

k8s-war-room does that investigation with a team of agents. It hands the engineer the likely cause, the evidence for
it, and a proposed fix. Nothing changes in the cluster until the engineer approves it.

## The agents

An agent is an LLM with a short job description and a small set of tools. Splitting the work across agents keeps each
one focused, lets the investigators run in parallel, and lets only one agent ever change the cluster.

| Agent      | Job                                                          | Can it change the cluster? |
| ---------- | ------------------------------------------------------------ | -------------------------- |
| Triage     | Reads the incident, posts hypotheses and investigation tasks | No                         |
| Logs       | Reads pod logs and reports what they show                    | No                         |
| Events     | Reads cluster events and rollouts                            | No                         |
| Web        | Searches the web for the error message                       | No                         |
| Remediator | Proposes a fix for the leading hypothesis                    | Only after approval        |
| Reviewer   | Checks the proposed fix before the engineer sees it          | No                         |

The engineer is part of the loop: any write to the cluster waits for their approval.

## The board

Agents never contact each other. They communicate only through the board, a shared place where they pick up tasks and
post and read what they know: tasks, findings, hypotheses and decisions.

For example, Triage posts the hypothesis "the container crashes on startup" and opens a task to check the logs. The
Logs agent claims that task and posts a finding with the log line as evidence. The Reviewer reads that finding later,
without ever talking to the Logs agent.

Because everything goes through the board, you can read a whole incident in one place, and you can add or remove an
agent without changing the others.
