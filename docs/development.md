# Develop and publish system-prompt

## Check a local checkout

```sh
npm ci --ignore-scripts
npm run check
pi -e .
```

Tests use temporary directories without changing your Pi settings or making model requests.

To use separate Pi settings and authentication, run:

```sh
PI_CODING_AGENT_DIR=/tmp/system-prompt-dev pi -e .
```

Put test prompts in `/tmp/system-prompt-dev/system-prompts/`. To keep a checkout installed, run `pi install .` and use `/reload` after source changes.

## Publish a release

1. Update the version with `npm version patch` or the required release type.
2. Add release notes to `CHANGELOG.md` and commit them.
3. Run `npm run check`.
4. Inspect the file list with `npm pack --dry-run`.
5. Sign in with `npm login` and publish with `npm publish --access public`.
6. Push the release commits and version tag.

The npm name is `system-prompt`. The `prepublishOnly` hook repeats the checks. Keep `pi.extensions` and the `pi-package` keyword in the manifest.
