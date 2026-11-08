/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/** Top-level entries that only the Inno Setup installer needs. */
const EXCLUDED_TOP_LEVEL_ENTRIES = new Set(['tools', 'appx']);

/**
 * Stages the built client (`VSCode-win32-<arch>`) for an installer that owns
 * updates itself (MSI/MSIX):
 *
 * - drops the Inno Setup updater (`tools/`) and the shell extension package
 *   (`appx/`) that the Inno installer would deploy itself;
 * - removes the update feed from `product.json` so the application update
 *   service stays permanently disabled (`MissingConfiguration`).
 */
export function prepareManagedPayload(sourceDir: string, destinationDir: string, versionedResourcesFolder = ''): void {
	fs.rmSync(destinationDir, { recursive: true, force: true });
	fs.mkdirSync(destinationDir, { recursive: true });

	fs.cpSync(sourceDir, destinationDir, {
		recursive: true,
		filter: source => {
			const relative = path.relative(sourceDir, source);
			if (!relative) {
				return true;
			}

			const topLevelEntry = relative.split(path.sep)[0].toLowerCase();
			return !EXCLUDED_TOP_LEVEL_ENTRIES.has(topLevelEntry);
		}
	});

	disableUpdates(path.join(destinationDir, versionedResourcesFolder, 'resources', 'app', 'product.json'));
}

function disableUpdates(productJsonPath: string): void {
	if (!fs.existsSync(productJsonPath)) {
		throw new Error(`Missing product.json in staged payload: ${productJsonPath}`);
	}

	const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
	delete productJson.updateUrl;
	fs.writeFileSync(productJsonPath, JSON.stringify(productJson, undefined, '\t'));
}
