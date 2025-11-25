# Documentation Index

This index provides a short map to the project's documentation. The repository keeps operator-facing and quick reference docs at the repository root; detailed technical guides are stored in `docs/`.

## Getting Started

- Main project README (quickstart, features, deployment): `../README.md`

## Technical Documentation

- Architecture Guide: `ARCHITECTURE.md` — Comprehensive technical architecture, file walkthrough, event contracts, deployment approaches, performance recommendations, and roadmap.
 - Database Guide: `DATABASE.md` — Complete database documentation including setup, schema reference, migrations, and SQL scripts


## Operational Documentation (kept in repo root)

These files remain in the repository root for easy operational access:

- `../BATCH_PROCESSING_ARCHITECTURE.md` — Batch processing event flow and component responsibilities
- `../QUEUE_SYSTEM.md` — Queue system configuration, event contracts, and operational guidance
- `../ADMIN_API.md` — Admin endpoints for monitoring and management

## Development & Testing

- Testing Guide: `TESTING.md` — Manual and automated testing procedures for batch processing
- Debugging Guide: `DEBUGGING.md` — Troubleshooting guide for common batch processing issues
- **[Contributing Guide](../CONTRIBUTING.md)** - Development setup, coding standards, and contribution workflow
## Additional Resources

- SQL scripts: `setup_new_db.sql` (root, canonical setup), `sql/` directory (reference queries and test data), `migrations/` (active migrations). See DATABASE.md for details.
- Test scripts (root): `test_scripts/batch_upload_test.js`
- Deployment scripts: `deploy.sh`, `setup-gcp.sh`, `cloud-run-config.yaml`
- Legacy code archive: `../archive/legacy-python/README.md`

### Development Tools
- `.editorconfig` - Editor configuration for consistent code formatting across IDEs
- `deploy.sh` - Automated deployment script for GCP Cloud Run
- `setup-gcp.sh` - Infrastructure provisioning script for GCP resources

Note: Reference SQL files have been organized into `docs/sql/` directory.

## Note

Please keep documentation up-to-date with code and configuration changes. If you find inaccuracies, open a GitHub issue and tag it as `documentation`.
