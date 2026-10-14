# Security

Lifts Coach is a personal application, not a public multi-user service. Protect the entire deployed hostname with a Cloudflare Access allow policy for your email. The API also verifies signed Access JWTs and refuses deployed requests without the configured issuer/audience. `LOCAL_DEV=true` only bypasses this check on loopback hosts.

Provision model credentials with Wrangler Worker secrets. Do not put keys in the PWA, a JSON backup, GitHub source, or screenshots. GitHub deployment credentials belong in encrypted repository/environment secrets with minimal Worker/D1 permissions.

Keep the tracked Wrangler template free of owner-specific metadata. GitHub variables or local environment variables supply D1 and Access identifiers; the configuration script writes only the ignored `wrangler.deploy.json`. Never force-add that file or a private backup. The generator does not copy provider or deployment credentials into its output.

Personal backups include training history, profile, notes and conversations. Treat them as private. Offline assets and training records remain on the installed browser/device even when its network login expires. Clear browser storage on a shared or retired device, after exporting any needed records.

If you find a vulnerability, use GitHub's **Report a vulnerability** private advisory feature on the repository when available; otherwise contact its maintainer privately. Include reproduction steps and the affected commit. Never include API keys, Access JWTs or real training records in a public issue. No private reporting mailbox has been created for this prototype.
