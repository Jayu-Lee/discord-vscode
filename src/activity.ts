import { basename, parse, sep } from 'path';
import { debug, env, extensions, Selection, TextDocument, window, workspace } from 'vscode';

import {
	CONFIG_KEYS,
	DEBUG_IMAGE_KEY,
	EMPTY,
	FILE_SIZES,
	IDLE_IMAGE_KEY,
	REPLACE_KEYS,
	UNKNOWN_GIT_BRANCH,
	UNKNOWN_GIT_REPO_NAME,
	VSCODE_IMAGE_KEY,
	VSCODE_INSIDERS_IMAGE_KEY,
} from './constants';
import { GitExtension } from './git';
import { log, LogLevel } from './logger';
import { getConfig, resolveFileIcon, toLower, toTitle, toUpper } from './util';

interface ActivityPayload {
	details?: string;
	state?: string;
	startTimestamp?: number | null;
	largeImageKey?: string;
	largeImageText?: string;
	smallImageKey?: string;
	smallImageText?: string;
	partyId?: string;
	partySize?: number;
	partyMax?: number;
	matchSecret?: string;
	joinSecret?: string;
	spectateSecret?: string;
	instance?: boolean;
}

export async function activity(previous: ActivityPayload = {}) {
	const config = getConfig();

	const appName = env.appName;
	const defaultSmallImageKey = debug.activeDebugSession
		? DEBUG_IMAGE_KEY
		: appName.includes('Insiders')
		? VSCODE_INSIDERS_IMAGE_KEY
		: VSCODE_IMAGE_KEY;

	let state: ActivityPayload = {
		details: await details(CONFIG_KEYS.DetailsIdling, CONFIG_KEYS.DetailsEditing, CONFIG_KEYS.DetailsDebugging),
		state: await details(
			CONFIG_KEYS.LowerDetailsIdling,
			CONFIG_KEYS.LowerDetailsEditing,
			CONFIG_KEYS.LowerDetailsDebugging,
		),
		startTimestamp: previous.startTimestamp ?? Date.now(),
		largeImageKey: IDLE_IMAGE_KEY,
		largeImageText: config[CONFIG_KEYS.LargeImageIdling],
		smallImageKey: defaultSmallImageKey,
		smallImageText: config[CONFIG_KEYS.SmallImage].replace(REPLACE_KEYS.AppName, appName),
	};

	if (window.activeTextEditor) {
		if (window.activeTextEditor.document.languageId === 'Log') {
			return state;
		}

		const largeImageKey = resolveFileIcon(window.activeTextEditor.document);
		const largeImageText = config[CONFIG_KEYS.LargeImage]
			.replace(REPLACE_KEYS.LanguageLowerCase, toLower(largeImageKey))
			.replace(REPLACE_KEYS.LanguageTitleCase, toTitle(largeImageKey))
			.replace(REPLACE_KEYS.LanguageUpperCase, toUpper(largeImageKey))
			.padEnd(2, EMPTY);

		state = {
			...state,
			details: await details(CONFIG_KEYS.DetailsIdling, CONFIG_KEYS.DetailsEditing, CONFIG_KEYS.DetailsDebugging),
			state: await details(
				CONFIG_KEYS.LowerDetailsIdling,
				CONFIG_KEYS.LowerDetailsEditing,
				CONFIG_KEYS.LowerDetailsDebugging,
			),
			largeImageKey,
			largeImageText,
		};

		log(LogLevel.Trace, `VSCode language id: ${window.activeTextEditor.document.languageId}`);
	}

	log(LogLevel.Debug, `Discord Presence being sent to discord:\n${JSON.stringify(state, null, 2)}`);

	return state;
}

async function details(idling: CONFIG_KEYS, editing: CONFIG_KEYS, debugging: CONFIG_KEYS) {
	const config = getConfig();
	let raw = (config[idling] as string).replace(REPLACE_KEYS.Empty, EMPTY);

	if (window.activeTextEditor) {
		const fileName = basename(window.activeTextEditor.document.fileName);
		const { dir } = parse(window.activeTextEditor.document.fileName);
		const split = dir.split(sep);
		const dirName = split[split.length - 1];

		const noWorkspaceFound = config[CONFIG_KEYS.LowerDetailsNoWorkspaceFound].replace(REPLACE_KEYS.Empty, EMPTY);
		const workspaceFolder = workspace.getWorkspaceFolder(window.activeTextEditor.document.uri);
		const workspaceFolderName = workspaceFolder?.name ?? noWorkspaceFound;
		const workspaceName = workspace.name ?? workspaceFolderName;
		const workspaceAndFolder = `${workspaceName}${workspaceFolderName === EMPTY ? '' : ` - ${workspaceFolderName}`}`;

		const fileIcon = resolveFileIcon(window.activeTextEditor.document);

		if (debug.activeDebugSession) {
			raw = config[debugging] as string;
		} else {
			raw = config[editing] as string;
		}

		if (workspaceFolder) {
			const { name } = workspaceFolder;
			const relativePath = workspace.asRelativePath(window.activeTextEditor.document.fileName).split(sep);
			relativePath.splice(-1, 1);
			raw = raw.replace(REPLACE_KEYS.FullDirName, `${name}${sep}${relativePath.join(sep)}`);
		}

		raw = await fileDetails(raw, window.activeTextEditor.document, window.activeTextEditor.selection);
		raw = raw
			.replace(REPLACE_KEYS.FileName, fileName)
			.replace(REPLACE_KEYS.DirName, dirName)
			.replace(REPLACE_KEYS.Workspace, workspaceName)
			.replace(REPLACE_KEYS.WorkspaceFolder, workspaceFolderName)
			.replace(REPLACE_KEYS.WorkspaceAndFolder, workspaceAndFolder)
			.replace(REPLACE_KEYS.LanguageLowerCase, toLower(fileIcon))
			.replace(REPLACE_KEYS.LanguageTitleCase, toTitle(fileIcon))
			.replace(REPLACE_KEYS.LanguageUpperCase, toUpper(fileIcon));
	}

	return raw;
}

async function fileDetails(_raw: string, document: TextDocument, selection: Selection) {
	let raw = _raw.slice();
	const gitExtension = extensions.getExtension<GitExtension>('vscode.git');
	const git = gitExtension?.exports.getAPI(1);

	if (raw.includes(REPLACE_KEYS.TotalLines)) {
		raw = raw.replace(REPLACE_KEYS.TotalLines, document.toLocaleString());
	}

	if (raw.includes(REPLACE_KEYS.CurrentLine)) {
		raw = raw.replace(REPLACE_KEYS.CurrentLine, (selection.active.line + 1).toLocaleString());
	}

	if (raw.includes(REPLACE_KEYS.CurrentColumn)) {
		raw = raw.replace(REPLACE_KEYS.CurrentColumn, (selection.active.character + 1).toLocaleString());
	}

	if (raw.includes(REPLACE_KEYS.FileSize)) {
		let currentDivision = 0;
		let { size } = await workspace.fs.stat(document.uri);
		const originalSize = size;
		if (originalSize > 1000) {
			size /= 1000;
			currentDivision++;
			while (size > 1000) {
				currentDivision++;
				size /= 1000;
			}
		}

		raw = raw.replace(
			REPLACE_KEYS.FileSize,
			`${originalSize > 1000 ? size.toFixed(2) : size}${FILE_SIZES[currentDivision]}`,
		);
	}

	if (raw.includes(REPLACE_KEYS.GitBranch)) {
		if (git?.repositories.length) {
			raw = raw.replace(
				REPLACE_KEYS.GitBranch,
				git.repositories.find((repo) => repo.ui.selected)?.state.HEAD?.name ?? EMPTY,
			);
		} else {
			raw = raw.replace(REPLACE_KEYS.GitBranch, UNKNOWN_GIT_BRANCH);
		}
	}

	if (raw.includes(REPLACE_KEYS.GitRepoName)) {
		if (git?.repositories.length) {
			raw = raw.replace(
				REPLACE_KEYS.GitRepoName,
				git.repositories
					.find((repo) => repo.ui.selected)
					?.state.remotes[0].fetchUrl?.split('/')[1]
					.replace('.git', '') ?? EMPTY,
			);
		} else {
			raw = raw.replace(REPLACE_KEYS.GitRepoName, UNKNOWN_GIT_REPO_NAME);
		}
	}

	return raw;
}
