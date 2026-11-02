# BlockIDE

BlockIDE is a Minecraft-focused IDE built on [Code - OSS](https://github.com/microsoft/vscode). It keeps the editing, navigation, debugging and extension model of VS Code and adds first-class Minecraft tooling: a Minecraft Java Edition launcher, a mod development workspace and a server manager, all bundled in.

## The Repository

This repository holds the source of BlockIDE and is maintained by ZIT Studio. It is a fork of the `Code - OSS` repository and is available under the standard [MIT license](LICENSE.txt). Upstream VS Code is developed by Microsoft and the community at [microsoft/vscode](https://github.com/microsoft/vscode).

## What BlockIDE changes

* **Product identity** — the application is named BlockIDE (`blockide`), with its own data folder, URL protocol, application icons and About dialog.
* **Built-in Minecraft Workbench** — the Minecraft Workbench extension by Lopleec is bundled as a git submodule at [extensions/minecraft-workbench](extensions/minecraft-workbench), tracked from [zitzhen/VSCode-minecraft-workbench](https://github.com/zitzhen/VSCode-minecraft-workbench), so it does not have to be installed from a VSIX. It activates on startup, which means the **Minecraft** view is already there when the IDE opens.
* **Default Minecraft sign-in** — a Microsoft public-client application ID is preconfigured for device code sign-in, so signing in with a Microsoft account works out of the box. Set `minecraftWorkbench.microsoftClientId` in Settings to switch to your own application ID.

## Bundled Extensions

BlockIDE includes a set of built-in extensions located in the [extensions](extensions) folder, including grammars and snippets for many languages. Extensions that provide rich language support (inline suggestions, Go to Definition) for a language have the suffix `language-features`. For example, the `json` extension provides coloring for `JSON` and the `json-language-features` extension provides rich language support for `JSON`.

The [minecraft-workbench](extensions/minecraft-workbench) extension is bundled as well, as a git submodule of [zitzhen/VSCode-minecraft-workbench](https://github.com/zitzhen/VSCode-minecraft-workbench). Its original upstream project, release history and issue tracker remain at [lopleec/VSCode-minecraft-workbench](https://github.com/lopleec/VSCode-minecraft-workbench).

## Development

Clone with submodules, or initialize them in an existing checkout — the build fails without the extension sources:

```sh
git clone --recurse-submodules https://github.com/zitzhen/BlockIDE.git
# or, in an existing checkout
git submodule update --init
```

The build setup is inherited from `Code - OSS`, so the upstream documentation still applies:

* [How to build and run from source](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
* [The development workflow, including debugging and running tests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#debugging)
* [Coding guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines)
* [Submitting pull requests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#pull-requests)

Changes to the bundled extension are built with [extensions/minecraft-workbench/.esbuild.mts](extensions/minecraft-workbench/.esbuild.mts), the entry point the repository build system uses:

```sh
cd extensions/minecraft-workbench
npm ci
npm run compile
```

## Feedback

* [File an issue](https://github.com/zitzhen/BlockIDE/issues)
* [Review source code changes](https://github.com/zitzhen/BlockIDE/pulls)

## Related Projects

Many of the core components and extensions to VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) repositories are separate from each other. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on the upstream wiki.

## Development Container

This repository includes a Code - OSS Dev Containers / GitHub Codespaces development container.

* For [Dev Containers](https://aka.ms/vscode-remote/download/containers), use the **Dev Containers: Clone Repository in Container Volume...** command, which creates a Docker volume for better disk I/O on macOS and Windows.

* For Codespaces, install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension and use the **Codespaces: Create New Codespace** command.

Docker / the Codespace should have at least **4 cores and 6 GB of RAM (8 GB recommended)** to run a full build. See the [development container README](.devcontainer/README.md) for more information.

## License

Copyright (c) Microsoft Corporation. All rights reserved.
Modifications and additions for BlockIDE: Copyright (c) ZIT Studio.

Licensed under the [MIT](LICENSE.txt) license.
