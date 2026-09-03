# GAOS Teleprompter

Web-based theatre teleprompter for live performances. The application is a
static HTML/JavaScript client with lightweight PHP synchronization and
filesystem persistence.

Start with:

- [`AGENTS.md`](AGENTS.md) for repository working rules;
- [`docs/architecture.md`](docs/architecture.md) for components, roles,
  persistence, and deployment policy;
- [`docs/synchronization.md`](docs/synchronization.md) for master/follower
  behavior;
- [`docs/annotations.md`](docs/annotations.md) for annotation storage and
  offline synchronization;
- [`docs/script-format.md`](docs/script-format.md) for show-script markup.
- [`docs/settings.md`](docs/settings.md) for browser display preferences and
  annotation margins.

Copyrighted production scripts and writable runtime JSON are installed or
created during deployment and are intentionally not tracked. The repository
retains only directory placeholders and sanitized/public test content.

Before running authenticated endpoints, copy
`scripts/passwords.example.php` to the ignored `scripts/passwords.php`, replace
every placeholder, and provision that file separately in production.
