# Publishing Collegiapp, PocketCanvas and the Homebrew tap

Everything that can be prepared without your accounts is ready. These steps are the ones that need you: creating the GitHub repos, adding the signing secrets, and tagging the first releases. All of it is free.

| repo | folder | what a release ships | how users update |
|---|---|---|---|
| `imanimal/collegiapp` | `~/Documents/Personal Projects/collegiapp` | Windows `-setup.exe` and `.msi`, macOS universal `.dmg` (plus `Collegiapp_universal.dmg` for Homebrew), `latest.json` | the app checks `latest.json` at launch and every 6 h, installs when you say so |
| `imanimal/pocketcanvas` | `~/Documents/Personal Projects/pocketcanvas` | `pocketcanvas-<version>.xpi` signed by Mozilla, `updates.json` | Firefox checks `updates.json` (the manifest's `update_url`) once a day |
| `imanimal/homebrew-tap` | `~/Documents/Personal Projects/homebrew-tap` | the Collegiapp cask and `install.sh` | the apps update themselves; the casks say `auto_updates` |

## 1. Back up the signing keys (do this first)

`~/.tauri/collegiapp.key` signs every update. Installed apps only accept updates signed by the key it shipped with, so if the key is lost, every installed copy has to be reinstalled by hand. Copy the file (and its `.pub`) somewhere safe that isn't the repo: a password manager's secure notes or an encrypted USB stick. They never go in git.

## 2. Create the repos and push

With the GitHub CLI (`gh auth login` once):

```bash
cd ~/"Documents/Personal Projects/collegiapp" && git init -b main && git add -A && git commit -m "Collegiapp 0.1.0" && gh repo create imanimal/collegiapp --public --source . --push
```

```bash
cd ~/"Documents/Personal Projects/pocketcanvas" && git init -b main && git add -A && git commit -m "PocketCanvas 0.1.0" && gh repo create imanimal/pocketcanvas --public --source . --push
```

```bash
cd ~/"Documents/Personal Projects/homebrew-tap" && git init -b main && git add -A && git commit -m "Cask for Collegiapp" && gh repo create imanimal/homebrew-tap --public --source . --push
```

Check `git status` before the first commit in each: build output (`target/`, `dist/`) is ignored, and nothing under `~/.tauri` is inside these folders.

## 3. Add the secrets

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY -R imanimal/collegiapp < ~/.tauri/collegiapp.key
```

PocketCanvas is signed by Mozilla as an unlisted add-on (free; not listed on the add-ons site, installed from GitHub). Sign in at addons.mozilla.org, open Developer Hub › Manage API keys, generate a key, then:

```bash
gh secret set AMO_JWT_ISSUER -R imanimal/pocketcanvas
```

```bash
gh secret set AMO_JWT_SECRET -R imanimal/pocketcanvas
```

(each asks you to paste the value).

## 4. Release

**Collegiapp:** bump `version` in `src-tauri/tauri.conf.json` (and `Cargo.toml`), commit, then tag and push:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The Release workflow builds Windows and macOS (universal) into a **draft** release, with `Collegiapp.mcpb` (the Claude Desktop extension, `tools/build_mcpb.py`) beside the installers. Open it on GitHub, read it over and press Publish: installed apps only see published releases.

**PocketCanvas:** the first release is the manifest's version as it is (tag `v0.1.0`). After that: `python tools/build.py --bump 0.1.1` (it updates the manifest), commit, tag `v0.1.1` and push the tag. The workflow has Mozilla sign the package and publishes the release with the `.xpi` and `updates.json`. Firefox refuses an unsigned `.xpi`, so the first real install has to come from a release, not a local build.

## 5. Homebrew

Once Collegiapp has a published release:

```bash
brew install --cask imanimal/tap/collegiapp
```

The cask downloads `releases/latest/download/Collegiapp_universal.dmg`, which the release workflow attaches under that stable name, so the cask never needs a version bump.

## What was left out on purpose

- **Apple notarization** needs the paid Apple Developer Program. The macOS builds are ad-hoc signed instead; the Homebrew cask and `install.sh` clear the download quarantine so they open, and a `.dmg` downloaded by hand opens with right-click › Open the first time.
- **Windows code signing** needs a paid certificate. The installers show a SmartScreen "More info › Run anyway" the first time.
- **Listing PocketCanvas on addons.mozilla.org** (public listing, review) is optional; unlisted signing is enough for self-updating installs.
