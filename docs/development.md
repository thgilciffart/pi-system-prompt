# Develop and publish pi-sys-prompt

## Run the checks

Install the development dependencies from the lockfile.

```sh
npm ci --ignore-scripts
```

Run the type checker and tests.

```sh
npm run check
```

The tests use temporary directories. They do not change your Pi settings or make model requests.

## Try the extension locally

Load the package for one Pi invocation.

```sh
pi -e .
```

To keep the local checkout installed, run `pi install .` from the repository. Run `/reload` after source changes.

To test with separate settings, set Pi's agent directory for the invocation.

```sh
PI_CODING_AGENT_DIR=/tmp/pi-sys-prompt-dev pi -e .
```

Add test prompts under `/tmp/pi-sys-prompt-dev/system-prompts/`. This invocation also uses separate Pi authentication and settings.

## Publish a release

1. Update the version in `package.json` and the lockfile with `npm version <version> --no-git-tag-version`.
2. Add the release changes to `CHANGELOG.md`.
3. Run `npm run check`.
4. Run `npm pack --dry-run` and inspect the file list. The archive includes source, documentation, examples, and the license.
5. Commit the release files and create a version tag.
6. Sign in to the npm account that owns the package name with `npm login`.
7. Run `npm publish --access public`. The `prepublishOnly` script repeats the checks.
8. Push the release commit and tag to GitHub.

The package manifest includes `pi.extensions` and the `pi-package` keyword. After npm publication, the keyword makes the package eligible for discovery on [pi.dev/packages](https://pi.dev/packages), as described in Pi's [package documentation](https://pi.dev/docs/latest/packages). Catalog indexing happens outside this repository.
