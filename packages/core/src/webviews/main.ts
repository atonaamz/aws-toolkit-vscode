/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { Protocol, registerWebviewServer } from './server'
import { getIdeProperties } from '../shared/extensionUtilities'
import { getFunctions } from '../shared/utilities/classUtils'
import { telemetry } from '../shared/telemetry/telemetry'
import { randomUUID } from '../shared/crypto'
import { Timeout } from '../shared/utilities/timeoutUtils'
import globals from '../shared/extensionGlobals'

interface WebviewParams {
    /**
     * The entry-point into the webview.
     */
    webviewJs: string

    /**
     * Stylesheets to use in addition to "base.css".
     */
    cssFiles?: string[]

    /**
     * Additional JS files to loaded in.
     */
    libFiles?: string[]
}

interface WebviewPanelParams extends WebviewParams {
    /**
     * ID of the webview which should be globally unique per view.
     */
    id: string

    /**
     * Title of the webview panel. This is shown in the editor tab.
     */
    title: string

    /**
     * Preserves the webview when not focused by the user.
     *
     * This has a performance penalty and should be avoided.
     */
    retainContextWhenHidden?: boolean

    /**
     * View column to initally show the view in. Defaults to split view.
     */
    viewColumn?: vscode.ViewColumn
}

interface WebviewViewParams extends WebviewParams {
    /**
     * ID of the webview which must be the same as the one used in `package.json`.
     */
    id: string

    /**
     * Title of the view. Defaults to the title set in `package.json` is not provided.
     */
    title?: string

    /**
     * Optional 'description' text applied to the title.
     */
    description?: string
}

export interface VueWebviewPanel<T extends VueWebview = VueWebview> {
    setup(webview: vscode.Webview): Promise<void>
    /**
     * Shows the webview with the given parameters.
     *
     * @returns A Promise that is resolved once the view is closed.
     */
    show(params: Omit<WebviewPanelParams, 'id' | 'webviewJs'>): Promise<vscode.WebviewPanel>

    /**
     * Forces a reload of the Vue runtime, resetting saved state without reloading the whole webview.
     */
    clear(): Promise<boolean>

    /**
     * The backend {@link VueWebview proxy} connected to this instance
     */
    readonly server: T
}

export interface VueWebviewView<T extends VueWebview = VueWebview> {
    /**
     * Registers the webview with VS Code.
     *
     * The view will not be rendered untl this is called.
     */
    register(params?: Partial<Omit<WebviewViewParams, 'id' | 'webviewJs'>>): vscode.Disposable

    /**
     * Event fired whenever the associated view is resolved.
     *
     * This can happen when the view first becomes visisble or when it is hidden and revealed again.
     */
    readonly onDidResolveView: vscode.Event<vscode.WebviewView>

    /**
     * The backend {@link VueWebview proxy} connected to this instance
     */
    readonly server: T
}

/**
 * Base class used to define client/server bindings for webviews.
 *
 * Sub-classes can be used to create new classes with fully-resolved bindings:
 * ```ts
 * class MyVueWebview extends VueWebview {
 *     public readonly id = 'foo'
 *     public readonly source = 'foo.js'
 *
 *     public constructor(private readonly myData: string) {
 *         super()
 *     }
 *
 *     public getMyData() {
 *         return this.myData
 *     }
 * }
 *
 * const Panel = VueWebview.compilePanel(MyVueWebview)
 * const view = new Panel(context, 'data')
 * view.show({ title: 'Foo' })
 * ```
 *
 * The unbound class type should then be used on the frontend:
 * ```ts
 * const client = WebviewClientFactory.create<MyVueWebview>()
 *
 * defineComponent({
 *   async created() {
 *       const data = await client.getMyData()
 *       console.log(data)
 *   },
 * })
 * ```
 *
 */
export abstract class VueWebview {
    /**
     * A unique identifier to associate with the webview.
     *
     * This must be the same as the `id` in `package.json` when using a WebviewView.
     */
    public abstract readonly id: string

    /**
     * Implementations must override this field to `true` if the webview can support
     * {@link telemetry.toolkit_didLoadModule}.
     * A webview that supports this will call {@link setDidLoad}
     * to confirm the UI has successfully loaded.
     */
    public supportsLoadTelemetry: boolean = false
    /**
     * The metadata used to connect {@link telemetry.toolkit_willOpenModule} and {@link telemetry.toolkit_didLoadModule}.
     * Always clear this field after load is completed, as it should not be shared with future open/loads.
     */
    public loadMetadata:
        | {
              /**
               * A unique identifier used to connect the opening/loaded metrics of a webview
               */
              traceId: string
              /**
               * When the webview is doing its initial render/load, this times out if it takes too long
               * to get a "success" message (we assume something went wrong)
               */
              loadTimeout: Timeout | undefined
              /**
               * The time in milliseconds, when the module was triggered to start loading
               */
              start: number
          }
        | undefined = undefined

    /**
     * The relative location, from the repository root, to the frontend entrypoint.
     */
    public readonly source: string

    private readonly protocol: Protocol
    private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>()
    private readonly onDidDispose = this.onDidDisposeEmitter.event

    private disposed = false
    private context?: vscode.ExtensionContext

    public constructor(source: string) {
        const commands: Record<string, (...args: any[]) => unknown> = {}
        const ctor = this.constructor as new (...args: any[]) => any

        for (const [k, v] of Object.entries(getFunctions(ctor))) {
            commands[k] = v.bind(this)
        }

        this.protocol = commands

        // All vue files defined by `source` are collected in to `dist/vue`
        // so we must update the relative paths to point here
        const sourcePath = vscode.Uri.joinPath(vscode.Uri.parse('vue/'), source).path
        this.source = sourcePath[0] === '/' ? sourcePath.slice(1) : sourcePath // VSCode URIs like to create root paths...
    }

    public get isDisposed() {
        return this.disposed
    }

    public getCompanyName(): string {
        return getIdeProperties().company
    }

    protected dispose(): void {
        this.disposed = true
        this.loadMetadata?.loadTimeout?.dispose()
        this.onDidDisposeEmitter.fire()
    }

    protected getContext(): vscode.ExtensionContext {
        if (!this.context) {
            throw new Error('Webview was not initialized with "ExtContext"')
        }

        return this.context
    }

    public static compilePanel<T extends new (...args: any[]) => VueWebview>(
        target: T
    ): new (context: vscode.ExtensionContext, ...args: ConstructorParameters<T>) => VueWebviewPanel<InstanceType<T>> {
        return class Panel {
            private readonly instance: InstanceType<T>
            private panel?: vscode.WebviewPanel

            public constructor(
                protected readonly context: vscode.ExtensionContext,
                ...args: ConstructorParameters<T>
            ) {
                this.instance = new target(...args) as InstanceType<T>

                for (const [prop, val] of Object.entries(this.instance)) {
                    if (val instanceof vscode.EventEmitter) {
                        Object.assign(this.instance.protocol, { [prop]: val })
                    }
                }
            }

            public get server() {
                return this.instance
            }

            public async setup(webview: vscode.Webview) {
                this.setupTelemetry()

                const server = registerWebviewServer(webview, this.instance.protocol, this.instance.id)
                this.instance.onDidDispose(() => {
                    server.dispose()
                })
            }

            /**
             * Setup telemetry events that report on the initial loading of a webview
             */
            private setupTelemetry() {
                const traceId = randomUUID()
                // Notify intent to open a module, this does not mean it successfully opened
                telemetry.toolkit_willOpenModule.emit({
                    module: this.instance.id,
                    result: 'Succeeded',
                    traceId: traceId,
                })

                // setup for when the webview is (possibly) loaded
                if (this.instance.supportsLoadTelemetry) {
                    // Arbitrary assumption that UI will take no longer than 10 seconds to load
                    const loadTimeout = new Timeout(10_000)
                    const start = globals.clock.Date.now()
                    this.instance.loadMetadata = {
                        traceId,
                        loadTimeout,
                        start,
                    }

                    // webview frontend did not successfuly respond quick enough, so we assume loading failed
                    loadTimeout.token.onCancellationRequested(() => {
                        telemetry.toolkit_didLoadModule.emit({
                            module: this.instance.id,
                            result: 'Failed',
                            traceId: traceId,
                            reason: 'LoadTimedOut',
                            reasonDesc: 'Likely due to an error in the frontend',
                        })
                        this.instance.loadMetadata = undefined
                    })
                }
            }

            public async show(params: Omit<WebviewPanelParams, 'id' | 'webviewJs'>): Promise<vscode.WebviewPanel> {
                if (this.panel) {
                    this.panel.reveal(params.viewColumn, false)
                    return this.panel
                }

                const panel = createWebviewPanel(this.context, {
                    id: this.instance.id,
                    webviewJs: this.instance.source,
                    ...params,
                })
                const server = registerWebviewServer(panel.webview, this.instance.protocol, this.instance.id)
                this.instance.onDidDispose(() => {
                    server.dispose()
                    this.panel?.dispose()
                    this.panel = undefined
                })

                return (this.panel = panel)
            }

            public async clear(): Promise<boolean> {
                return this.panel?.webview.postMessage({ command: '$clear' }) ?? false
            }
        }
    }

    public static compileView<T extends new (...args: any[]) => VueWebview>(
        target: T
    ): new (context: vscode.ExtensionContext, ...args: ConstructorParameters<T>) => VueWebviewView<InstanceType<T>> {
        return class View {
            private readonly onDidResolveViewEmitter = new vscode.EventEmitter<vscode.WebviewView>()
            private readonly instance: InstanceType<T>
            private resolvedView?: vscode.WebviewView

            public readonly onDidResolveView = this.onDidResolveViewEmitter.event

            public constructor(
                protected readonly context: vscode.ExtensionContext,
                ...args: ConstructorParameters<T>
            ) {
                this.instance = new target(...args) as InstanceType<T>

                for (const [prop, val] of Object.entries(this.instance)) {
                    if (val instanceof vscode.EventEmitter) {
                        Object.assign(this.instance.protocol, { [prop]: val })
                    }
                }

                this.instance.context = this.context
            }

            public get server() {
                return this.instance
            }

            public register(params: Omit<WebviewViewParams, 'id' | 'webviewJs'>): vscode.Disposable {
                return vscode.window.registerWebviewViewProvider(this.instance.id, {
                    resolveWebviewView: async (view) => {
                        view.title = params.title ?? view.title
                        view.description = params.description ?? view.description
                        updateWebview(this.context, view.webview, {
                            ...params,
                            webviewJs: this.instance.source,
                        })

                        if (!this.resolvedView) {
                            this.resolvedView = view

                            const server = registerWebviewServer(
                                this.resolvedView.webview,
                                this.instance.protocol,
                                this.instance.id
                            )
                            this.resolvedView.onDidDispose(() => {
                                server.dispose()
                                this.resolvedView = undefined
                            })
                        }

                        this.onDidResolveViewEmitter.fire(view)
                    },
                })
            }
        }
    }

    /**
     * Call this after the webview has successfully loaded
     */
    protected setDidLoad(module: string) {
        this.loadMetadata?.loadTimeout?.dispose()

        // Represents time from intent to open, to confirmation of a successful load
        const duration = globals.clock.Date.now() - this.loadMetadata!.start

        telemetry.toolkit_didLoadModule.emit({
            passive: true,
            module,
            result: 'Succeeded',
            traceId: this.loadMetadata?.traceId,
            duration,
        })

        this.loadMetadata = undefined
    }

    /**
     * Call this if we catch an error in the frontend, and are able to forward it to the backed
     *
     * @param message Error message from the frontend
     */
    public setLoadFailure(module: string, message: string) {
        this.loadMetadata?.loadTimeout?.dispose()

        telemetry.toolkit_didLoadModule.emit({
            passive: true,
            module,
            result: 'Failed',
            traceId: this.loadMetadata?.traceId,
            reason: 'CaughtFrontendError',
            reasonDesc: message,
        })

        this.loadMetadata = undefined
    }
}

type FilteredKeys<T> = { [P in keyof T]: unknown extends T[P] ? never : P }[keyof T]
type FilterUnknown<T> = Pick<T, FilteredKeys<T>>
type Commands<T extends VueWebview> = {
    [P in keyof T]: T[P] extends (...args: any[]) => any ? T[P] : unknown
}
type Events<T extends VueWebview> = {
    [P in keyof T]: T[P] extends vscode.EventEmitter<any> ? T[P] : unknown
}
export type ClassToProtocol<T extends VueWebview> = FilterUnknown<Commands<T> & Events<T>>

/**
 * This is the {@link vscode.WebviewView} version of {@link compileVueWebview}.
 *
 * The biggest difference is that only a single view per-id can exist at a time, while multiple panels can exist per-id.
 * Views also cannot register handlers for `submit`; any `submit` commands made by the fronend are ignored.
 *
 * @param params Required parameters are defined by {@link WebviewViewParams}, optional parameters are defined by {@link WebviewCompileOptions}
 *
 * @returns An anonymous class that can instantiate instances of {@link VueWebviewView}.
 */

/**
 * Creates a brand new webview panel, setting some basic initial parameters and updating the webview.
 */
function createWebviewPanel(ctx: vscode.ExtensionContext, params: WebviewPanelParams): vscode.WebviewPanel {
    const viewColumn = params.viewColumn ?? vscode.ViewColumn.Active

    const panel = vscode.window.createWebviewPanel(
        params.id,
        params.title,
        { viewColumn },
        {
            // The redundancy here is to correct a bug with Cloud9's Webview implementation
            // We need to assign certain things on instantiation, otherwise they'll never be applied to the view
            // TODO: Comment is old, no cloud9 support anymore. Is this needed?
            enableScripts: true,
            enableCommandUris: true,
            retainContextWhenHidden: params.retainContextWhenHidden,
        }
    )
    updateWebview(ctx, panel.webview, params)

    return panel
}

function resolveRelative(webview: vscode.Webview, rootUri: vscode.Uri, files: string[]): vscode.Uri[] {
    return files.map((f) => webview.asWebviewUri(vscode.Uri.joinPath(rootUri, f)))
}

/**
 * Mutates a webview, applying various options and a static HTML page to bootstrap the Vue code.
 */
function updateWebview(ctx: vscode.ExtensionContext, webview: vscode.Webview, params: WebviewParams): vscode.Webview {
    const dist = vscode.Uri.joinPath(ctx.extensionUri, 'dist')
    const resources = vscode.Uri.joinPath(ctx.extensionUri, 'resources')

    webview.options = {
        enableScripts: true,
        enableCommandUris: true,
        localResourceRoots: [dist, resources],
    }

    const libs = resolveRelative(webview, vscode.Uri.joinPath(dist, 'libs'), [
        'vscode.js',
        'vue.min.js',
        ...(params.libFiles ?? []),
    ])

    const css = resolveRelative(webview, vscode.Uri.joinPath(resources, 'css'), [
        'base.css',
        ...(params.cssFiles ?? []),
    ])

    const mainScript = webview.asWebviewUri(vscode.Uri.joinPath(dist, params.webviewJs))

    webview.html = resolveWebviewHtml({
        scripts: libs.map((p) => `<script src="${p}"></script>`).join('\n'),
        stylesheets: css.map((p) => `<link rel="stylesheet" href="${p}">\n`).join('\n'),
        main: mainScript,
        webviewJs: params.webviewJs,
        cspSource: webview.cspSource,
    })

    return webview
}

/**
 * Resolves the webview HTML based off whether we're running from a development server or bundled extension.
 */
function resolveWebviewHtml(params: {
    scripts: string
    stylesheets: string
    cspSource: string
    webviewJs: string
    main: vscode.Uri
}): string {
    const resolvedParams = { ...params, connectSource: `'none'` }
    const localServer = process.env.WEBPACK_DEVELOPER_SERVER

    if (localServer) {
        const local = vscode.Uri.parse(localServer)
        resolvedParams.cspSource = `${params.cspSource} ${local.toString()}`
        resolvedParams.main = local.with({ path: `/${params.webviewJs}` })
        resolvedParams.connectSource = `'self' ws:`
    }

    return `<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <meta
            http-equiv="Content-Security-Policy"
            content=
                "default-src 'none';
                connect-src ${resolvedParams.connectSource};
                img-src ${resolvedParams.cspSource} https: data:;
                script-src ${resolvedParams.cspSource};
                style-src ${resolvedParams.cspSource} 'unsafe-inline';
                font-src ${resolvedParams.cspSource} 'self' data:;"
        >
    </head>
    <body>
        <div id="vue-app"></div>
        <!-- Dependencies -->
        ${resolvedParams.scripts}
        ${resolvedParams.stylesheets}
        <!-- Main -->
        <script src="${resolvedParams.main}"></script>
    </body>
</html>`
}
