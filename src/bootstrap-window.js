/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference path="typings/require.d.ts" />

//@ts-check
'use strict';

// Simple module style to support node.js and browser environments
(function (globalThis, factory) {

	// Node.js
	if (typeof exports === 'object') {
		module.exports = factory();
	}

	// Browser
	else {

		const patchTimeout = true;
		if (patchTimeout) {
			const oldSetTimeout = window.setTimeout;
			const oldClearTimeout = window.clearTimeout;
			const timeoutGroups = {};
			const lift = 1024;

			let nstCalls = 0;
			let ostCalls = 0;
			let cancels = 0;
			let groupsScanned = 0;

			// print diagnostics on what the patch is doing
			setInterval(() => {
				// console.log('pass through rate ' + ostCalls / nstCalls);
				// console.log('avg scanned ' + groupsScanned / nstCalls);
				// console.log('cancel rate ' + cancels / nstCalls);
				console.log(JSON.parse(JSON.stringify(timeoutGroups)));
			}, 4000);

			const newSetTimeout = (func, delay, /*doesn't support args at the moment*/) => {
				nstCalls++;
				const now = Date.now();
				const triggerTime = delay + now;

				for (let groupTimeString in timeoutGroups) {
					groupsScanned++;
					const group = timeoutGroups[groupTimeString];
					const groupTime = group.time;
					const groupLeft = groupTime - now;
					const ratio = (10 + delay) / Math.abs(10 + groupLeft);
					if (ratio < 2.5 && 0.7 < ratio) {
						const id = group.handle * lift + group.funcs.length;
						group.funcs.push(func);
						return id;
					}
				}

				const group = { funcs: [func], count: 1, time: triggerTime, handle: 0 };
				const runTimeoutGroup = () => {
					// console.log("run timeout group")
					for (let func of group.funcs) {
						if (func !== null) {
							func();
						}
					}
					delete timeoutGroups[group.handle];
				};
				ostCalls++;
				group.handle = oldSetTimeout(runTimeoutGroup, delay);
				timeoutGroups[group.handle] = group;
				return group.handle * lift;
			};
			window.setTimeout = newSetTimeout;

			const newClearTimeout = (handle) => {
				if (typeof handle !== 'number') {
					return;
				}
				const groupHandle = Math.floor(handle / lift);
				const funcIndex = handle % lift;
				const group = timeoutGroups[groupHandle];
				if (group === undefined || group.funcs.length - 1 < funcIndex || group.funcs[funcIndex] === null) {
					return;
				}
				cancels++;
				group.funcs[funcIndex] = null;
				group.count--;
				if (group.count === 0) {
					oldClearTimeout(group.handle);
					delete timeoutGroups[groupHandle];
				}
			};
			window.clearTimeout = newClearTimeout;

			if (window.requestIdleCallback) {
				const oldRIC = window.requestIdleCallback;
				const oldCIC = window.cancelIdleCallback;
				let incId = 0;
				let icFunctions = [];
				let icCount = 0;
				let idleCallback = undefined;
				let idStart = 0;

				const newRIC = (func, options) => {
					const id = incId;
					incId++;
					icFunctions.push(func);
					icCount++;

					if (idleCallback === undefined) {
						idleCallback = oldRIC(() => {
							idleCallback = undefined;

							const oldIcFunctions = icFunctions;
							idStart += oldIcFunctions.length;
							icFunctions = [];
							icCount = 0;
							for (let func of oldIcFunctions) {
								if (func) {
									func();
								}
							}
						});
					}
					return id;
				};
				window.requestIdleCallback = newRIC;

				const newCIC = (handle) => {
					if (icFunctions.length + idStart > handle) {
						icFunctions[handle - idStart] = null;
						icCount--;
						if (icCount === 0) {
							oldCIC(idleCallback); // cancelling might never be worth it?
						}
					}
				};
				window.cancelIdleCallback = newCIC;
			}

			const patchInterval = false;
			if (patchInterval) {
				// rn not caring about interval phase, see if it works
				const oldSetInterval = window.setInterval;
				const oldClearInterval = window.clearInterval;

				const intervals = {};

				const newSetInterval = (func, time) => {
					for (let intervalHandle in intervals) {
						const interval = intervals[intervalHandle];
						const ratio = interval.time / time;
						if (0.8 < ratio && ratio < 1.4) {
							const id = interval.handle * lift + interval.functions.length;
							interval.functions.push(func);
							interval.count++;
							return id;
						}
					}
					const interval = { time, functions: [func], handle: 0, count: 1 };
					const runIntervalGroup = () => {
						let c = 0;
						for (let func of interval.functions) {
							if (func) {
								func();
								c++;
							}
						}
						if (c > 1) {
							console.log(`batched ${c} intervals`);
						}
					};
					interval.handle = oldSetInterval(runIntervalGroup, time);
					intervals[interval.handle] = interval;
				};
				window.setInterval = newSetInterval;
				const newClearInterval = (handle) => {
					const upper = Math.floor(handle / lift);
					const lower = handle % lift;
					const interval = intervals[upper];
					if (interval) {
						if (interval.functions[lower]) {
							interval.functions[lower] = undefined;
							interval.count--;
							if (interval.count === 0) {
								oldClearInterval(interval.handle);
							}
						}
					}
				};
				window.clearInterval = newClearInterval;
			}
		}

		globalThis.MonacoBootstrapWindow = factory();
	}
}(this, function () {
	const bootstrapLib = bootstrap();
	const preloadGlobals = sandboxGlobals();
	const safeProcess = preloadGlobals.process;
	const useCustomProtocol = safeProcess.sandboxed || typeof safeProcess.env['VSCODE_BROWSER_CODE_LOADING'] === 'string';

	/**
	 * @typedef {import('./vs/base/parts/sandbox/common/sandboxTypes').ISandboxConfiguration} ISandboxConfiguration
	 *
	 * @param {string[]} modulePaths
	 * @param {(result: unknown, configuration: ISandboxConfiguration) => Promise<unknown> | undefined} resultCallback
	 * @param {{
	 *  configureDeveloperSettings?: (config: ISandboxConfiguration) => {
	 * 		forceDisableShowDevtoolsOnError?: boolean,
	 * 		forceEnableDeveloperKeybindings?: boolean,
	 * 		disallowReloadKeybinding?: boolean,
	 * 		removeDeveloperKeybindingsAfterLoad?: boolean
	 * 	},
	 * 	canModifyDOM?: (config: ISandboxConfiguration) => void,
	 * 	beforeLoaderConfig?: (loaderConfig: object) => void,
	 *  beforeRequire?: () => void
	 * }} [options]
	 */
	async function load(modulePaths, resultCallback, options) {

		// Error handler (TODO@sandbox non-sandboxed only)
		let showDevtoolsOnError = !!safeProcess.env['VSCODE_DEV'];
		safeProcess.on('uncaughtException', function (/** @type {string | Error} */ error) {
			onUnexpectedError(error, showDevtoolsOnError);
		});

		// Await window configuration from preload
		performance.mark('code/willWaitForWindowConfig');
		/** @type {ISandboxConfiguration} */
		const configuration = await preloadGlobals.context.resolveConfiguration();
		performance.mark('code/didWaitForWindowConfig');

		// Signal DOM modifications are now OK
		if (typeof options?.canModifyDOM === 'function') {
			options.canModifyDOM(configuration);
		}

		// Developer settings
		const {
			forceDisableShowDevtoolsOnError,
			forceEnableDeveloperKeybindings,
			disallowReloadKeybinding,
			removeDeveloperKeybindingsAfterLoad
		} = typeof options?.configureDeveloperSettings === 'function' ? options.configureDeveloperSettings(configuration) : {
			forceDisableShowDevtoolsOnError: false,
			forceEnableDeveloperKeybindings: false,
			disallowReloadKeybinding: false,
			removeDeveloperKeybindingsAfterLoad: false
		};
		showDevtoolsOnError = safeProcess.env['VSCODE_DEV'] && !forceDisableShowDevtoolsOnError;
		const enableDeveloperKeybindings = safeProcess.env['VSCODE_DEV'] || forceEnableDeveloperKeybindings;
		let developerDeveloperKeybindingsDisposable;
		if (enableDeveloperKeybindings) {
			developerDeveloperKeybindingsDisposable = registerDeveloperKeybindings(disallowReloadKeybinding);
		}

		// Enable ASAR support
		globalThis.MonacoBootstrap.enableASARSupport(configuration.appRoot);

		// Get the nls configuration into the process.env as early as possible
		const nlsConfig = globalThis.MonacoBootstrap.setupNLS();

		let locale = nlsConfig.availableLanguages['*'] || 'en';
		if (locale === 'zh-tw') {
			locale = 'zh-Hant';
		} else if (locale === 'zh-cn') {
			locale = 'zh-Hans';
		}

		window.document.documentElement.setAttribute('lang', locale);

		// Do not advertise AMD to avoid confusing UMD modules loaded with nodejs
		if (!useCustomProtocol) {
			window['define'] = undefined;
		}

		// Replace the patched electron fs with the original node fs for all AMD code (TODO@sandbox non-sandboxed only)
		if (!safeProcess.sandboxed) {
			require.define('fs', [], function () { return require.__$__nodeRequire('original-fs'); });
		}

		window['MonacoEnvironment'] = {};

		const loaderConfig = {
			baseUrl: useCustomProtocol ?
				`${bootstrapLib.fileUriFromPath(configuration.appRoot, { isWindows: safeProcess.platform === 'win32', scheme: 'vscode-file', fallbackAuthority: 'vscode-app' })}/out` :
				`${bootstrapLib.fileUriFromPath(configuration.appRoot, { isWindows: safeProcess.platform === 'win32' })}/out`,
			'vs/nls': nlsConfig,
			preferScriptTags: useCustomProtocol
		};

		// use a trusted types policy when loading via script tags
		if (loaderConfig.preferScriptTags) {
			loaderConfig.trustedTypesPolicy = window.trustedTypes?.createPolicy('amdLoader', {
				createScriptURL(value) {
					if (value.startsWith(window.location.origin)) {
						return value;
					}
					throw new Error(`Invalid script url: ${value}`);
				}
			});
		}

		// Enable loading of node modules:
		// - sandbox: we list paths of webpacked modules to help the loader
		// - non-sandbox: we signal that any module that does not begin with
		//                `vs/` should be loaded using node.js require()
		if (safeProcess.sandboxed) {
			loaderConfig.paths = {
				'vscode-textmate': `../node_modules/vscode-textmate/release/main`,
				'vscode-oniguruma': `../node_modules/vscode-oniguruma/release/main`,
				'xterm': `../node_modules/xterm/lib/xterm.js`,
				'xterm-addon-search': `../node_modules/xterm-addon-search/lib/xterm-addon-search.js`,
				'xterm-addon-unicode11': `../node_modules/xterm-addon-unicode11/lib/xterm-addon-unicode11.js`,
				'xterm-addon-webgl': `../node_modules/xterm-addon-webgl/lib/xterm-addon-webgl.js`,
				'iconv-lite-umd': `../node_modules/iconv-lite-umd/lib/iconv-lite-umd.js`,
				'jschardet': `../node_modules/jschardet/dist/jschardet.min.js`,
			};
		} else {
			loaderConfig.amdModulesPattern = /^vs\//;
		}

		// Cached data config (node.js loading only)
		if (!useCustomProtocol && configuration.codeCachePath) {
			loaderConfig.nodeCachedData = {
				path: configuration.codeCachePath,
				seed: modulePaths.join('')
			};
		}

		// Signal before require.config()
		if (typeof options?.beforeLoaderConfig === 'function') {
			options.beforeLoaderConfig(loaderConfig);
		}

		// Configure loader
		require.config(loaderConfig);

		// Handle pseudo NLS
		if (nlsConfig.pseudo) {
			require(['vs/nls'], function (nlsPlugin) {
				nlsPlugin.setPseudoTranslation(nlsConfig.pseudo);
			});
		}

		// Signal before require()
		if (typeof options?.beforeRequire === 'function') {
			options.beforeRequire();
		}

		// Actually require the main module as specified
		require(modulePaths, async result => {
			try {

				// Callback only after process environment is resolved
				const callbackResult = resultCallback(result, configuration);
				if (callbackResult instanceof Promise) {
					await callbackResult;

					if (developerDeveloperKeybindingsDisposable && removeDeveloperKeybindingsAfterLoad) {
						developerDeveloperKeybindingsDisposable();
					}
				}
			} catch (error) {
				onUnexpectedError(error, enableDeveloperKeybindings);
			}
		}, onUnexpectedError);
	}

	/**
	 * @param {boolean | undefined} disallowReloadKeybinding
	 * @returns {() => void}
	 */
	function registerDeveloperKeybindings(disallowReloadKeybinding) {
		const ipcRenderer = preloadGlobals.ipcRenderer;

		const extractKey =
			/**
			 * @param {KeyboardEvent} e
			 */
			function (e) {
				return [
					e.ctrlKey ? 'ctrl-' : '',
					e.metaKey ? 'meta-' : '',
					e.altKey ? 'alt-' : '',
					e.shiftKey ? 'shift-' : '',
					e.keyCode
				].join('');
			};

		// Devtools & reload support
		const TOGGLE_DEV_TOOLS_KB = (safeProcess.platform === 'darwin' ? 'meta-alt-73' : 'ctrl-shift-73'); // mac: Cmd-Alt-I, rest: Ctrl-Shift-I
		const TOGGLE_DEV_TOOLS_KB_ALT = '123'; // F12
		const RELOAD_KB = (safeProcess.platform === 'darwin' ? 'meta-82' : 'ctrl-82'); // mac: Cmd-R, rest: Ctrl-R

		/** @type {((e: KeyboardEvent) => void) | undefined} */
		let listener = function (e) {
			const key = extractKey(e);
			if (key === TOGGLE_DEV_TOOLS_KB || key === TOGGLE_DEV_TOOLS_KB_ALT) {
				ipcRenderer.send('vscode:toggleDevTools');
			} else if (key === RELOAD_KB && !disallowReloadKeybinding) {
				ipcRenderer.send('vscode:reloadWindow');
			}
		};

		window.addEventListener('keydown', listener);

		return function () {
			if (listener) {
				window.removeEventListener('keydown', listener);
				listener = undefined;
			}
		};
	}

	/**
	 * @param {string | Error} error
	 * @param {boolean} [showDevtoolsOnError]
	 */
	function onUnexpectedError(error, showDevtoolsOnError) {
		if (showDevtoolsOnError) {
			const ipcRenderer = preloadGlobals.ipcRenderer;
			ipcRenderer.send('vscode:openDevTools');
		}

		console.error(`[uncaught exception]: ${error}`);

		if (error && typeof error !== 'string' && error.stack) {
			console.error(error.stack);
		}
	}

	/**
	 * @return {{ fileUriFromPath: (path: string, config: { isWindows?: boolean, scheme?: string, fallbackAuthority?: string }) => string; }}
	 */
	function bootstrap() {
		// @ts-ignore (defined in bootstrap.js)
		return window.MonacoBootstrap;
	}

	/**
	 * @return {typeof import('./vs/base/parts/sandbox/electron-sandbox/globals')}
	 */
	function sandboxGlobals() {
		// @ts-ignore (defined in globals.js)
		return window.vscode;
	}

	return {
		load
	};
}));
