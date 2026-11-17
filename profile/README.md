# Practical Works

**A small software shop in Tampa Bay. We build, deploy and run software for teams who need it in production.** We take apps that were prototyped fast (or vibe-coded) and make them production-grade, run self-hosted business systems, and put AI agents to work inside real teams.

We run our own company on the same stack we build for others, and we open-source the pieces we depend on every day. Everything below is MIT and maintained because we use it.

## Open source

| Project | What it's for |
|---|---|
| [**rc-bridge**](https://github.com/PracticalWorks/rc-bridge) | Put an AI agent in [Rocket.Chat](https://www.rocket.chat): one conversation per thread, reactions as receipts, images and files, streaming. Plus a typed Rocket.Chat REST client. npm: [`@practicalworks/rc-bridge`](https://www.npmjs.com/package/@practicalworks/rc-bridge), [`@practicalworks/rc-client`](https://www.npmjs.com/package/@practicalworks/rc-client) |
| [**crm**](https://github.com/PracticalWorks/crm) | A typed client for the [Twenty](https://twenty.com) CRM's REST API, the lead record as a Twenty App, and typed Inngest events when a lead moves. npm: [`@practicalworks/crm`](https://www.npmjs.com/package/@practicalworks/crm) |
| [**guardrails**](https://www.npmjs.com/package/@practicalworks/guardrails) | Shared git hooks as one dev dependency: a ticket reference on every commit, your own hooks kept, and a guard that stops an AI coding agent from printing your secrets. npm: [`@practicalworks/guardrails`](https://www.npmjs.com/package/@practicalworks/guardrails) |
| [**inngest-vps**](https://github.com/practical-works-acropolis/inngest-vps) | Self-hosted [Inngest](https://www.inngest.com) in one command on a small VPS: Docker Compose (Inngest, Postgres, Redis, Caddy TLS) plus Terraform, about $12 a month |
| [**claude-code-secret-guard**](https://github.com/practical-works-acropolis/claude-code-secret-guard) | A Claude Code hook that stops the agent from printing your secret values into the transcript |
| [**turnwrk/shared**](https://github.com/TurnWrk/shared) | One contract for a suite of field-service apps: canonical types, roles, Firestore collection paths and rules, and the money model, vendored into each app so they never drift apart |

Every npm package is published from CI with [provenance](https://docs.npmjs.com/generating-provenance-statements), so you can check that what you install was built from the code you can read here.

Issues, questions and pull requests are welcome on any of them.

## Work with us

If you need a hand shipping an app, rescuing one, or putting an agent to work, we take on projects: [practical.works](https://practical.works) · [book a call](https://practical.works/call) · hello@practical.works

Founded by [Julissa Cotillo](https://github.com/jcotillo) and [Alan Campbell](https://github.com/Echobob).
