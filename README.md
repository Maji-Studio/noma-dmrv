# noma-dmrv

A production-ready Next.js 16 template with authentication, database, and best practices baked in.

## Features

- ✅ **Next.js 16** with App Router and React 19
- ✅ **TypeScript** with strict mode enabled
- ✅ **Authentication** with Better Auth (admin-invite only)
- ✅ **Database** with PostgreSQL, Drizzle ORM
- ✅ **Email** with Resend for transactional emails
- ✅ **UI Components** with Base UI (unstyled, accessible)
- ✅ **State Management** with React Query and Zustand
- ✅ **Styling** with Tailwind CSS 4 and custom design system
- ✅ **Code Quality** with ESLint and TypeScript strict mode
- ✅ **Layered Architecture** with clear separation of concerns

## Quick Start

### Prerequisites

- Node.js 20+ and pnpm
- Docker Desktop (for local PostgreSQL)
- Resend API key (optional for local dev, required for real email delivery)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/noma-dmrv.git
   cd noma-dmrv
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your configuration (see Environment Variables section).

4. Start the development server:
   ```bash
   pnpm dev
   ```

   This automatically:
   - Starts PostgreSQL via Docker
   - Runs database migrations
   - Seeds test data (on first run)
   - Starts Next.js on port 3100

5. Open [http://localhost:3100](http://localhost:3100) in your browser.

**Note**: The `dev` command handles database setup automatically. For manual control, see `docs/database.md`.

## Environment Variables

Create a `.env.local` file with the following variables:

- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_APP_URL` - Your app URL (e.g., http://localhost:3100)
- `BETTER_AUTH_SECRET` - 32+ character secret for Better Auth
- `RESEND_API_KEY` - Optional locally, required in production for email delivery
- `RESEND_FROM_EMAIL` - Optional locally, required in production for email delivery
- `ADMIN_EMAIL` - Admin email address
- `ALLOW_SELF_SIGNUP` - Set to `false` for admin-invite only (recommended)
- `LOG_LEVEL` - Optional: `debug`, `info`, `warn`, or `error`

See `.env.example` for a complete template.

When `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are not set, auth email flows still work in local development by logging verification/reset URLs in the server console.

## Project Structure

```
├── src/
│   ├── app/               # Next.js App Router
│   │   ├── (auth)/        # Auth routes (login, password reset)
│   │   ├── (app)/         # Protected app routes
│   │   │   ├── projects/  # Project list
│   │   │   └── [projectId]/ # Project-scoped routes
│   │   │       ├── dashboard/ # Example dashboard
│   │   │       ├── items/ # Example CRUD
│   │   │       └── settings/ # Project settings
│   │   ├── admin/         # Admin panel
│   │   └── api/           # API routes
│   ├── components/        # React components
│   │   ├── ui/            # Base UI components
│   │   ├── items/         # Example feature components
│   │   └── navigation/    # Navigation components
│   ├── config/            # Configuration (env validation)
│   ├── data-access/       # Database queries + auth guards
│   ├── db/                # Database connection & schema
│   │   └── schema/        # Drizzle table schemas
│   ├── fn/                # Server actions ("use server")
│   ├── hooks/             # React Query hooks
│   ├── lib/               # Utilities
│   │   └── auth/          # Authentication utilities
│   └── types/             # TypeScript types
└── docs/                  # Documentation
```

## Architecture

This template follows a strict layered architecture:

```
Component (UI)
    ↓
hooks/ (React Query - client state)
    ↓
fn/ (Server actions - validation & orchestration)
    ↓
data-access/ (Database queries + auth guards)
    ↓
db/ (Database connection & schema)
```

**Key principles:**
- Each layer only imports from the layer below
- Server actions always validate input with Zod
- Data access functions always check authentication
- Business logic lives in pure, testable functions

See `TEMPLATE_USAGE.md` for detailed guidance on extending the template.

## Example Features

The template includes example CRUD functionality to demonstrate patterns:

- **Dashboard** - Simple overview page
- **Items** - Full CRUD with create, read, update, archive
- **Projects** - Multi-tenant project structure
- **Settings** - Project configuration scaffold

These serve as reference implementations - customize or remove as needed.

## Available Commands

### Development
- `pnpm dev` - Start development server with Docker database (port 3100)
- `pnpm dev:manual` - Start Next.js only (assumes Docker running separately)
- `pnpm build` - Build for production
- `pnpm start` - Run production server
- `pnpm lint` - Run ESLint checks

### Docker & Database
- `pnpm docker:up` - Start PostgreSQL container
- `pnpm docker:down` - Stop PostgreSQL (keeps data)
- `pnpm docker:clean` - Stop and remove all database data
- `pnpm db:generate` - Generate new migrations from schema changes
- `pnpm db:push` - Push schema changes directly to database
- `pnpm db:studio` - Open Drizzle Studio for database exploration
- `pnpm db:seed` - Manually seed test data
- `pnpm db:reset` - Drop and recreate database with fresh seed data

## Authentication

This template uses an **admin-invite by default** authentication system:

1. Public signup is controlled by `ALLOW_SELF_SIGNUP` (default: `false`)
2. Password reset and email verification flows are enabled
3. `/admin/users` is reserved as a scaffold route for invite UI

Set `ALLOW_SELF_SIGNUP=false` in production to enforce invite-only access.

## Design System

The template includes a custom design system with:
- **Typography** - Semantic text classes (`.title-heading-1`, `.body-large`, etc.)
- **Spacing** - CSS variables and utility classes (`gap-m`, `pt-l`, etc.)
- **Colors** - Theme-aware color tokens
- **Components** - Base UI components (unstyled, accessible)

See `docs/design-system.md` for the complete design system reference.

## Documentation

### Getting Started
- **[Template Usage](TEMPLATE_USAGE.md)** - Comprehensive guide to extending this template
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

### Core Documentation
- **[Architecture](docs/architecture.md)** - System design and implementation patterns
- **[Design System](docs/design-system.md)** - UI tokens, typography, and component patterns
- **[Database](docs/database.md)** - Drizzle ORM setup and migration guide
- **[Isometric Requirements KB](docs/isometric/README.md)** - Biochar + Soil Storage requirement summaries, pinned versions, and schema coverage mapping
- **[Authentication](docs/auth.md)** - Better Auth configuration and authentication flows
- **[Forms](docs/forms.md)** - React Hook Form integration with Zod validation
- **[Security](docs/security.md)** - Security best practices and guidelines
- **[Mail Setup](docs/mail-setup.md)** - Email configuration with Resend

## License

MIT License - feel free to use this template for your projects.

## Credits

Built with:
- [Next.js](https://nextjs.org/)
- [Better Auth](https://better-auth.com/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Base UI](https://base-ui.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [React Query](https://tanstack.com/query)
