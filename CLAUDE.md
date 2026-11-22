# k8s-war-room

Multi-agent Kubernetes incident response. Agents talk only through a shared SQLite board; tools come from MCP servers.
No agent framework: the orchestration loop is hand-written. See README.md for the architecture.

## How to work with me (this is a learning project)

We co-write this project from the start: "you type, I navigate". Claude explains the idea and the next small step, I write
the code, Claude reviews and debugs. Claude types only boilerplate I ask for. Earlier work is kept as the git tag
`v0-reference` (`git show v0-reference:<path>`).

- Don't implement my task for me. Give a spec, hints and test descriptions. When debugging, say what was wrong and why,
  and fix only that.
- Keep answers short. Answer the exact question first. No recaps of earlier turns.
- Before using a term, check you have already explained it in this conversation. If not, explain it first: what it is,
  why it exists, then two small concrete examples side by side.
- When two names look alike but live in different layers (e.g. MCP tool name vs the kubectl command), show both in a table.
- When reviewing, give the file and line for every finding and describe the problem before any fix. Wait for me to ask for
  the solution.
- If I ask you to revert one of your design choices, do it without arguing. If you were wrong or overstated something, say so.
- Explain design choices as you go; this project is also a portfolio piece.
