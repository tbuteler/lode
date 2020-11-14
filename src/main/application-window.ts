import * as Path from 'path'
import { get } from 'lodash'
import { app, ipcMain, BrowserWindow } from 'electron'
import { getResourceDirectory } from '@lib/helpers/paths'
import { state } from '@lib/state'
import { ProjectIdentifier, ProjectOptions, Project } from '@lib/frameworks/project'
import { send } from '@main/ipc'

let windowStateKeeper: any | null = null

const windows: any = {}

export class ApplicationWindow {

    protected window: BrowserWindow

    protected minWidth = 960
    protected minHeight = 660

    protected ready: boolean = false
    protected project: Project | null = null

    public constructor (identifier: ProjectIdentifier | null) {

        if (!windowStateKeeper) {
            // `electron-window-state` requires Electron's `screen` module, which can
            // only be required after the app has emitted `ready`. So require it lazily.
            windowStateKeeper = require('electron-window-state')
        }

        // Load saved window state, if any
        const savedWindowState = windowStateKeeper({
            defaultHeight: this.minHeight,
            defaultWidth: this.minWidth
        })

        // Initial window options
        const windowOptions: Electron.BrowserWindowConstructorOptions = {
            x: savedWindowState.x,
            y: savedWindowState.y,
            width: savedWindowState.width,
            height: savedWindowState.height,
            minWidth: this.minWidth,
            minHeight: this.minHeight,
            useContentSize: true,
            backgroundColor: '#fff',
            webPreferences: {
                // Disable auxclick event
                // See https://developers.google.com/web/updates/2016/10/auxclick
                disableBlinkFeatures: 'Auxclick',
                backgroundThrottling: false,
                scrollBounce: true,
                nodeIntegration: false,
                contextIsolation: true,
                worldSafeExecuteJavaScript: true,
                enableRemoteModule: false,
                preload: Path.resolve(getResourceDirectory(), 'preload.js')
            },
            acceptFirstMouse: true
        }

        if (__DARWIN__) {
            windowOptions.titleBarStyle = 'hiddenInset'
        } else if (__WIN32__) {
            windowOptions.frame = false
        } else if (__LINUX__) {
            windowOptions.icon = Path.join(__static, 'icons/512x512.png')
        }

        this.window = new BrowserWindow(windowOptions)

        // Remember "parent" window when using devtools.
        this.window.webContents.on('devtools-focused', () => {
            ipcMain.emit('window-set', this)
        })

        // Remember window state on change
        savedWindowState.manage(this.window)

        if (identifier) {
            this.setProject(identifier)
        }

        this.load()
    }

    public static init (identifier: ProjectIdentifier | null): ApplicationWindow {
        const window = new this(identifier)

        // Store parent in window manager
        windows[window.getChild().id] = window

        window.onClosed(async () => {
            if (window.isBusy()) {
                log.info('Window is busy. Attempting teardown of pending processes.')
                try {
                    await window.getProject()!.stop()
                } catch (_) {}
            }
            app.quit()
        })

        return window
    }

    public static getFromWebContents(webContents: Electron.WebContents): ApplicationWindow | null {
        const child = BrowserWindow.fromWebContents(webContents)
        return child ? windows[child.id] : null
    }

    public static getProjectFromWebContents(webContents: Electron.WebContents): Project | null {
        const window = this.getFromWebContents(webContents)
        return window ? window.getProject() : null
    }

    protected load () {
        this.window.webContents.once('did-finish-load', () => {
            if (process.env.NODE_ENV === 'development') {
                this.window.webContents.openDevTools()
            }
        })

        this.window.webContents.on('did-finish-load', () => {
            this.onReady()
            send(this.window.webContents, 'did-finish-load', [{
                projectId: get(this.getProject(), 'id', null),
                focus: this.window.isFocused(),
                version: app.getVersion()
            }])
            this.window.webContents.setVisualZoomLevelLimits(1, 1)
        })

        this.window.on('focus', () => {
            this.window.webContents.send('focus')
            ipcMain.emit('window-set', this)
        })
        this.window.on('blur', () => this.window.webContents.send('blur'))

        this.window.loadURL(
            process.env.NODE_ENV === 'development'
                ? `http://localhost:9080`
                : `file://${__dirname}/index.html`
        )
    }

    public send (event: string, args: Array<any> = []) {
        send(this.window.webContents, event, args)
    }

    public reload () {
        this.window.reload()
    }

    public onClosed (fn: (event: any) => void) {
        this.window.on('closed', fn)
    }

    public setProject (identifier: ProjectIdentifier): void {
        // Instantiate new project from identifier. If it does not yet exist
        // in the store, it'll be created.
        this.project = new Project(this, identifier)
        this.project
            // @TODO: when setting another project, make sure previous one's
            // listeners are no longer active.
            .on('ready', async () => {
                if (!this.ready) {
                    return
                }
                this.projectReady()
            })
            .on('progress', this.updateProgress.bind(this))
    }

    public onReady (): void {
        this.ready = true
        this.refreshSettings()
        // If project and window are ready, send to renderer, otherwise wait for
        // `this.setProject` ready listener to trigger it. This means we can have
        // have the project ready in the main process and reload the renderer.
        if (this.project && this.project.isReady()) {
            this.projectReady()
        }
    }

    public getChild (): BrowserWindow {
        return this.window
    }

    public getWebContents (): Electron.WebContents {
        return this.window.webContents
    }

    public getProject (): Project | null {
        return this.project
    }

    public getProjectOptions (): ProjectOptions {
        return this.project ? this.project.render() : {}
    }

    public async projectReady (): Promise<void> {
        await this.project!.reset()
        send(this.window.webContents, 'project-ready', [this.getProjectOptions()])
        this.refreshActiveFramework()
        this.refreshSettings()
    }

    public refreshActiveFramework (): void {
        if (this.project) {
            const { framework, repository } = this.project.getActive()
            this.send('framework-active', [
                framework ? framework.getId() : null,
                repository ? repository.render() : null
            ])
        }
    }

    protected refreshSettings (): void {
        this.send('settings-updated', [state.get()])
    }

    protected updateProgress (progress: number): void {
        // If project progress has reached 100%, disable the progress bar.
        this.window.setProgressBar(progress === 1 ? -1 : progress)
    }

    public isBusy (): boolean {
        return !!this.project && this.project.isBusy()
    }

    public clear (): void {
        this.project = null
        this.refreshSettings()
        this.send('clear')
    }

    public sendMenuEvent (args: any) {
        this.window.show()
        this.window.webContents.send('menu-event', args)
    }
}
