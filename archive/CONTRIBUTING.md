# Contributing to PDF-to-CSV

Thanks for wanting to contribute! This guide explains how to get your environment ready, coding standards, testing expectations, and the PR process.

## 1. Introduction
This project extracts structured contact information from PDF documents using Google Document AI and provides a React frontend for uploads and monitoring. See `README.md` for a high-level overview.

## 2. Development Setup
Prerequisites:
- Node.js 18.x
- npm 8.x+
- PostgreSQL 15.x (or a compatible instance)
- Docker (optional for container testing)
- Google Cloud SDK (if deploying to GCP)

Local setup (backend):
```bash
cd server
npm install
cp .env.example .env
# Edit .env with your local DB and Google credentials
```

Local setup (frontend):
```bash
cd client
npm install
cp .env.example .env
# Adjust VITE_API_URL to point at your local backend
```

Database:
- Use `setup_new_db.sql` (root) to create the canonical schema for development.

## 3. Project Structure
Key directories:
- `client/` - React frontend
- `server/` - Node.js backend
- `docs/` - Project documentation (architecture, testing, debugging)
- `archive/` - Legacy code (do not modify unless intentionally restoring)

See `README.md` and `docs/ARCHITECTURE.md` for a full walkthrough.

## 4. Development Workflow
- Branch naming: `feature/<short-desc>`, `bugfix/<short-desc>`, `hotfix/<short-desc>`
- Use conventional commits where possible (e.g. `feat: add X`, `fix: correct Y`)
- Run tests and linters before pushing

## 5. Coding Standards
- JavaScript: 2-space indentation, prefer `const`/`let`, use async/await for promises
- Logging: use `logger` (`winston`) used across server code
- Keep functions small and document non-obvious behavior with comments

## 6. Testing
- Manual testing: see `docs/TESTING.md`
- Unit tests: add tests under `server/test/` or `client/test/` following existing patterns
- Document AI integration: use the `/api/test/document-ai` endpoint for a quick sanity check

## 7. Database Changes
- Add migrations under `migrations/`
- Test locally against a PostgreSQL 15 instance
- Avoid destructive schema changes without a migration script

## 8. Deployment
- See `deploy.sh` and `cloud-run-config.yaml` for Cloud Run deployment
- Confirm environment variables and Secret Manager entries before deploying

## 9. Documentation
- Update `docs/` when adding or changing behavior
- Keep `README.md` in sync with major changes

## 10. Pull Requests
PR checklist:
- Describe the changes and motivation
- Include tests for new behavior
- Update documentation where applicable
- Ensure no sensitive credentials are included

## 11. Code of Conduct
Be respectful and professional in code reviews, issues, and PR discussions.

---
If you need help, open an issue or contact the maintainers listed in the project README.
