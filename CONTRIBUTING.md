# Contributing to BlockIDE

Welcome, and thank you for your interest in contributing to BlockIDE!

BlockIDE is a fork of [Code - OSS](https://github.com/microsoft/vscode) that bundles Minecraft tooling. There are several ways in which you can contribute, beyond writing code. The goal of this document is to provide a high-level overview of how you can get involved.

## Scope: where to contribute

* **BlockIDE-specific changes** — product identity, application icons, bundled extensions, build configuration and Minecraft features belong in this repository: [zitzhen/BlockIDE](https://github.com/zitzhen/BlockIDE).
* **Upstream VS Code behaviour** — if a problem reproduces in [VS Code](https://github.com/microsoft/vscode) itself, report or fix it upstream. Keeping inherited code close to upstream makes later syncs easier.
* **The Minecraft Workbench extension** — this repository vendors [lopleec/VSCode-minecraft-workbench](https://github.com/lopleec/VSCode-minecraft-workbench) as a built-in extension. Report upstream unless the change is specific to the bundled build.

## Asking Questions

Have a question about BlockIDE? Please open an issue in this repository instead of asking on unrelated channels.

For questions about the inherited VS Code core, the [Stack Overflow](https://stackoverflow.com/questions/tagged/visual-studio-code) tag `visual-studio-code` still applies.

## Reporting Issues

### Look for an existing issue

Before you create a new issue, search the [open issues](https://github.com/zitzhen/BlockIDE/issues) to see whether the problem or feature request has already been filed.

If you find your issue already exists, add relevant comments and a [reaction](https://github.com/blog/2119-add-reactions-to-pull-requests-issues-and-comments) instead of a "+1" comment:

* 👍 - upvote
* 👎 - downvote

### Writing good bug reports and feature requests

File a single issue per problem or feature request. Do not enumerate multiple bugs in the same issue, and do not add your issue as a comment to an unrelated existing one.

Please include the following with each issue:

* Version of BlockIDE
* Your operating system
* List of extensions that you have installed
* Reproducible steps (1... 2... 3...) that cause the issue
* What you expected to see, versus what you actually saw
* Images, animations, or a link to a video showing the issue occurring
* A code snippet that demonstrates the issue, or a link to a repository the developers can pull down
  * **Note:** Because the developers need to copy and paste the code snippet, including it only as a media file (i.e. .gif) is not sufficient.
* Errors from the Dev Tools Console (open from the menu: Help > Toggle Developer Tools)

For Minecraft Workbench behaviour, include the extension log from the **Output** panel (`Minecraft Workbench`) as well.

### Follow your issue

Once submitted, the maintainers will triage your report and may ask for more information. Please respond rather than closing the issue, so the report stays actionable.

## Contributing Code

### Build from source

The build setup is inherited from `Code - OSS`:

```sh
npm install
npm run compile
./scripts/code.sh
```

Alternatively open the repository in VS Code and press `F5`. For incremental development use `npm run watch`.

### Build the bundled extension

The Minecraft Workbench sources live in [extensions/minecraft-workbench](extensions/minecraft-workbench) and are built by [.esbuild.mts](extensions/minecraft-workbench/.esbuild.mts), the entry point the repository build system picks up:

```sh
cd extensions/minecraft-workbench
npm ci
npm run compile
```

`npm run compile` runs a type check before bundling. Do not commit `node_modules` or `dist`; both are ignored.

### Commit conventions

* One commit per logical change — avoid large commits that mix unrelated edits.
* Describe *why* the change is needed, not only what changed.
* Build and type check before you commit.

### Creating pull requests

* Link the issue your pull request addresses.
* Explain what changed and why, and list the steps you used to verify it.
* Keep changes focused on inherited upstream files where possible, so that syncing with `Code - OSS` stays simple.
* Refer to the upstream article on [creating pull requests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#pull-requests) and the [coding guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines).

## Thank You

Your contributions to open source, large or small, make great projects like this possible. Thank you for taking the time to contribute.
