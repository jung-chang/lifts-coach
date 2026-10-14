# Contributing

Keep `fitness_app_product_spec.md` unchanged unless the owner explicitly approves a product-plan edit. Preserve the Electric Minimal tokens and approval/snapshot/local-first invariants. Add meaningful tests for changes to edit scopes, backup validation, timer transitions, or synchronization. Run `pnpm test` and `pnpm build` before opening a pull request.

Never commit `.dev.vars`, API keys, personal backups, or real workout history. Update manually curated evidence from verified primary sources, with applicability, confidence and limitations. Do not turn Coach into an unsolicited feed or add a model call to set logging.

Read [AGENTS.md](AGENTS.md) before contributing. Review the exact staged paths and diff before committing, and run `pnpm check:public` before pushing. That check flags common credential formats and private file types without printing matched secret values; it complements a manual disclosure review and cannot prove that all content is safe to publish.
