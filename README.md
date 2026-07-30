# noma dMRV

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**noma dMRV** is an open-source monitoring, reporting, and verification platform
for biochar carbon removal. It helps operators trace biomass from intake through
pyrolysis, biochar delivery, and application, then prepare auditable removal data
for carbon registries.

The project is under active development and is not yet a production system.

## What it covers

- End-to-end material traceability from facilities and reactors through feedstock,
  production runs, biochar products, deliveries, applications, and credit batches
- Chain-of-custody lineage with mass-balance and evidence tracking
- Production energy, transport, and emissions accounting
- Biochar sampling, laboratory characterization, and durability workflows
- Isometric Certify integration for registry-aligned validation and submission
- Facility-scoped access control, audit-friendly records, and document management

## Technology

- Next.js 16, React 19, and TypeScript
- PostgreSQL with Drizzle ORM
- Better Auth
- React Query, React Hook Form, and Zod
- Tailwind CSS and Base UI
- Vitest and Playwright

## Getting started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)
- Docker Desktop, for the local PostgreSQL database

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/Maji-Studio/noma-dmrv.git
   cd noma-dmrv
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a local environment file and review the documented variables:

   ```bash
   cp .env.example .env.local
   ```

4. Start the development environment:

   ```bash
   pnpm dev
   ```

The development command starts PostgreSQL and runs the app at
[http://localhost:3100](http://localhost:3100). If the local schema is new or
out of date, run `pnpm db:migrate` before starting the app.

## Architecture

Application code follows a layered flow:

```text
UI components
  -> hooks/        React Query client state
  -> fn/           validated server actions
  -> data-access/  authorization and database queries
  -> db/           database connection and schema
```

Each layer imports only from the layer below it. Server actions validate inputs,
and the data-access layer enforces authentication and authorization before every
database operation.

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the app and local PostgreSQL database |
| `pnpm build` | Build the production application |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run the TypeScript compiler without emitting files |
| `pnpm test` | Run the Vitest test suite |
| `pnpm test:e2e` | Run the Playwright end-to-end suite |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Documentation

- [Architecture](docs/architecture.md)
- [Domain glossary](CONTEXT.md)
- [Adding a feature](TEMPLATE_USAGE.md)
- [Authentication and organization scope](docs/auth.md)
- [Database](docs/database.md)
- [Schema overview](docs/schema-overview.md)
- [Forms](docs/forms.md)
- [Security](docs/security.md)
- [Object storage](docs/storage.md)
- [Testing](docs/testing.md)
- [Traceability](docs/traceability.md)
- [Isometric requirements knowledge base](docs/isometric/README.md)
- [Troubleshooting](docs/troubleshooting.md)

## Contributing

Issues and pull requests are welcome. Please keep changes focused, follow the
existing layered architecture, and run the relevant lint, type, and test checks
before opening a pull request. Development branches target `staging`.

## Security

Do not report security vulnerabilities in a public issue. Contact
[Maji Studio](mailto:kenji@maji.studio) privately instead.

## License

Licensed under the [MIT License](LICENSE).
