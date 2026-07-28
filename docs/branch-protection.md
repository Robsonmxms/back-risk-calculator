# Branch Protection

Require pull requests before merging into:

- `develop`
- `release/**`
- `main`

Required backend checks:

- `Backend Quality`
- `Backend Migrations And Seed`

Recommended settings:

- require branches to be up to date before merge;
- require conversation resolution;
- block force pushes and deletions on protected branches;
- allow deployment workflows only after AWS runtime, database, queue, storage, and rollback
  runbooks are approved.
