import '@lib/crash/reporter'
import '@lib/logger/main'
import '@lib/tracker/main'

import Fs from 'fs'
import Path from 'path'
import { stringify } from 'flatted'
import { isEmpty, identity, pickBy } from 'lodash'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
    applicationMenu,
    ProjectMenu,
    RepositoryMenu,
    FrameworkMenu,
    SuiteMenu,
    TestMenu,
    FileMenu
} from '@main/menu'
import { ApplicationWindow } from '@main/application-window'
import { Updater } from '@main/updater'
import { LogLevel } from '@lib/logger/levels'
import { mergeEnvFromShell } from '@lib/process/shell'
import { state } from '@lib/state'
import { log as writeLog } from '@lib/logger'
import {
    ProjectIdentifier,
    ProjectActiveIdentifiers,
    ProjectEntities,
    ProjectOptions,
    IProject
} from '@lib/frameworks/project'
import { IRepository } from '@lib/frameworks/repository'
import { Frameworks } from '@lib/frameworks'
import {
    FrameworkOptions,
    FrameworkFilter
} from '@lib/frameworks/framework'
import { Nugget } from '@lib/frameworks/nugget'
import { ISuite } from '@lib/frameworks/suite'
import { ITest } from '@lib/frameworks/test'
import {
    PotentialRepositoryOptions,
    RepositoryValidator,
    FrameworkValidator,
    PotentialFrameworkOptions
} from '@lib/frameworks/validator'

let currentWindow: ApplicationWindow | null = null

// Merge environment variables from shell, if needed.
mergeEnvFromShell()

// Set `__static` path to static files in production
if (process.env.NODE_ENV !== 'development') {
    (global as any).__static = require('path').join(__dirname, '/static').replace(/\\/g, '\\\\')
} else {
    // Check for special development scripts (e.g. migrations)
    const argv = process.argv.slice(3)
    if (argv.length) {
        if (argv[0] === 'migrate') {
            if (argv[1] === 'down') {
                state.migrateDownTo()
            } else if (argv[1] === 'up') {
                state.migrateUpTo()
            }
        }
        process.exit()
    }
}

function getProject (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): IProject {
    return ApplicationWindow.getProjectFromWebContents(event.sender)!
}

function getRepository (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, repositoryId: string): Promise<IRepository> {
    return new Promise(async (resolve, reject) => {
        const project: IProject = getProject(event)
        const repository: IRepository = project.getRepositoryById(repositoryId)!
        if (repository) {
            resolve(repository!)
            return
        }
        log.error(`Error while getting repository ${repositoryId}.`)
        reject()
    })
}

function entities (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
    frameworkId: string,
    identifiers: Array<string> = []
): Promise<ProjectEntities> {
    return new Promise(async (resolve, reject) => {
        try {
            const project: IProject = getProject(event)
            const context = project.getContextByFrameworkId(frameworkId)
            if (context) {
                const { repository, framework } = context
                const entities = { project, repository, framework }

                if (!identifiers.length) {
                    resolve(entities)
                    return
                }
                let nugget: Nugget | undefined
                const nuggets: Array<Nugget> = []
                do {
                    // First nugget is always a suite, all others are tests.
                    nugget = nugget ? nugget.findTest(identifiers.shift()!) : framework.getSuiteById(identifiers.shift()!)
                    if (!nugget) {
                        throw Error
                    }
                    nuggets.push(nugget)
                    if (!nugget.expanded) {
                        await nugget.toggleExpanded(true, false)
                    }
                } while (identifiers.length > 0)

                resolve({ ...entities, nuggets, nugget })
                return
            }
        } catch (_) {}
        log.error(`Unable to find requested entities '${JSON.stringify({ frameworkId, identifiers })}'`)
        reject()
    })
}

app
    .on('ready', () => {
        track.screenview('Application started')
        currentWindow = ApplicationWindow.init(state.getCurrentProject())
        applicationMenu.build(currentWindow)

        if (!__DEV__) {
            // Start auto-updating process.
            new Updater()
            return
        }

        setInterval(() => {
            process.getProcessMemoryInfo().then(memory => {
                log.info(`Private: ${memory.private}, Shared: ${memory.shared}`)
            })
        }, 5000)
    })

ipcMain
    .on('log', (event: Electron.IpcMainEvent, level: LogLevel, message: string) => {
        // Write renderer messages to log, if they meet the level threshold.
        // We're using the main log function directly so that they are not
        // marked as being from the "main" process.
        writeLog(level, message)
    })
    .on('track-screenview', (event: Electron.IpcMainEvent, screen: string) => {
        track.screenview(screen)
    })
    .on('track-event', (event: Electron.IpcMainEvent, category: string, action: string, label: string | null, value: string | null) => {
        track.event(category, action, label, value)
    })
    .on('window-set', (event: Electron.IpcMainEvent, args: any[]) => {
        currentWindow = event as any
    })
    .on('menu-refresh', (event: Electron.IpcMainEvent) => {
        applicationMenu.build(currentWindow)
    })
    .on('menu-event', (event: Electron.IpcMainEvent, args: any[]) => {
        const { name, properties } = event as any
        if (currentWindow) {
            currentWindow.sendMenuEvent({ name, properties })
        }
    })
    .on('project-switch', (event: Electron.IpcMainEvent, identifier?: ProjectIdentifier | null) => {
        const window: ApplicationWindow = ApplicationWindow.getFromWebContents(event.sender)!
        const project: IProject | null = window.getProject()
        if (identifier && !isEmpty(pickBy(identifier, identity))) {
            window.setProject(identifier)
            state.set('currentProject', window.getProject()!.getId())
        } else {
            window.clear()
        }
        if (project) {
            project.stop()
        }
    })
    .on('project-repositories', (event: Electron.IpcMainEvent, identifier: ProjectIdentifier) => {
        getProject(event).emitRepositoriesToRenderer()
    })
    .on('project-active-framework', (event: Electron.IpcMainEvent, frameworkId: ProjectActiveIdentifiers['framework']) => {
        const project = getProject(event)
        project.setActiveFramework(frameworkId)
        applicationMenu.setOptions(project.getActive())
    })
    .on('repository-remove', (event: Electron.IpcMainEvent, repositoryId: string) => {
        const project: IProject = getProject(event)
        project.removeRepository(repositoryId)
        project.emitRepositoriesToRenderer()
        ApplicationWindow.getFromWebContents(event.sender)!.refreshActiveFramework()
    })
    .on('repository-toggle', async (event: Electron.IpcMainEvent, repositoryId: string, toggle: boolean) => {
        const repository = await getRepository(event, repositoryId)
        if (toggle) {
            repository.expand()
            return
        }
        repository.collapse()
    })
    .on('framework-add', async (event: Electron.IpcMainEvent, repositoryId: string, options: FrameworkOptions) => {
        const repository: IRepository = await getRepository(event, repositoryId)
        repository.addFramework(options).then(framework => {
            framework.refresh()
        })
        repository.emitFrameworksToRenderer()
        ApplicationWindow.getFromWebContents(event.sender)!.refreshActiveFramework()
    })
    .on('framework-remove', async (event: Electron.IpcMainEvent, frameworkId: string) => {
        entities(event, frameworkId).then(({ repository, framework }) => {
            repository.removeFramework(framework.getId())
            repository.emitFrameworksToRenderer()
            ApplicationWindow.getFromWebContents(event.sender)!.refreshActiveFramework()
        })
    })
    .on('framework-update', (event: Electron.IpcMainEvent, frameworkId: string, options: FrameworkOptions) => {
        entities(event, frameworkId).then(({ repository, framework }) => {
            framework.updateOptions({
                ...options,
                repositoryPath: repository.getPath()
            })
            repository.emitFrameworksToRenderer()
            event.sender.send('framework-options-updated', framework.render())
            framework.emitSuitesToRenderer()
        })
    })
    .on('framework-refresh', (event: Electron.IpcMainEvent, frameworkId: string) => {
        entities(event, frameworkId).then(({ framework }) => {
            framework.refresh()
        })
    })
    .on('framework-start', (event: Electron.IpcMainEvent, frameworkId: string) => {
        entities(event, frameworkId).then(({ framework }) => {
            framework.start()
        })
    })
    .on('framework-stop', (event: Electron.IpcMainEvent, frameworkId: string) => {
        entities(event, frameworkId).then(({ framework }) => {
            framework.stop()
        })
    })
    .on('framework-suites', (event: Electron.IpcMainEvent, frameworkId: string) => {
        entities(event, frameworkId).then(({ framework }) => {
            framework.emitSuitesToRenderer()
        })
    })
    .on('framework-filter', (event: Electron.IpcMainEvent, frameworkId: string, key: FrameworkFilter, value: any) => {
        entities(event, frameworkId).then(({ framework }) => {
            framework.setFilter(key, value)
        })
    })
    .on('framework-reset-filters', (event: Electron.IpcMainEvent, frameworkId: string) => {
        entities(event, frameworkId).then(({ framework }) => {
            framework.resetFilters()
        })
    })
    .on('framework-toggle-child', async (event: Electron.IpcMainEvent, frameworkId: string, identifiers: Array<string>, toggle: boolean) => {
        entities(event, frameworkId, identifiers).then(({ nugget }) => {
            if (toggle) {
                // If we're expanding it, send the tests to the renderer.
                event.sender.send(
                    `${nugget!.getId()}:framework-tests`,
                    nugget!.tests.map((test: ITest) => test.render(false))
                )
                return
            }
            // If collapsing, just wither the nugget, no response is needed.
            nugget!.toggleExpanded(false, true)
        })
    })
    .on('framework-select', async (event: Electron.IpcMainEvent, frameworkId: string, identifiers: Array<string>, toggle: boolean) => {
        entities(event, frameworkId, identifiers).then(({ nugget }) => {
            nugget!.toggleSelected(toggle, true)
        })
    })
    .on('nugget-context-menu', async (event: Electron.IpcMainEvent, frameworkId: string, identifiers: Array<string>) => {
        entities(event, frameworkId, identifiers).then(({ nuggets }) => {
            if (nuggets) {
                if (nuggets.length === 1) {
                    new SuiteMenu((nuggets.pop() as ISuite), event.sender)
                        .open()
                } else {
                    new TestMenu((nuggets.shift() as ISuite), (nuggets.pop() as ITest), event.sender)
                        .open()

                }
            }
        })
    })
    .on('select-all', (event: Electron.IpcMainEvent) => {
        event.sender.selectAll()
    })
    .on('settings-update', (event: Electron.IpcMainEvent, setting: string, value: any) => {
        state.set(setting, value)
        event.sender.send('settings-updated', state.get())
    })
    .on('settings-reset', (event: Electron.IpcMainEvent) => {
        state.reset()
        const window: ApplicationWindow | null = ApplicationWindow.getFromWebContents(event.sender)
        if (window) {
            window.clear()
            window.reload()
        }
    })

ipcMain
    .handle('project-remove', async (event: Electron.IpcMainInvokeEvent) => {
        const project: IProject = getProject(event)
        await project.delete()
        return state.removeProject(project.getId())
    })

ipcMain
    .handle('project-update', async (event: Electron.IpcMainInvokeEvent, options: ProjectOptions) => {
        const project: IProject | null = ApplicationWindow.getProjectFromWebContents(event.sender)
        if (project) {
            project.updateOptions(options)
            return project.render()
        }
        return null
    })

ipcMain
    .handle('project-empty-repositories', async (event: Electron.IpcMainInvokeEvent) => {
        return getProject(event).getEmptyRepositories()
    })

ipcMain
    .handle('project-add-repositories-menu', async (event: Electron.IpcMainInvokeEvent) => {
        return (await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            properties: ['openDirectory', 'multiSelections']
        })).filePaths
    })

ipcMain
    .handle('project-context-menu', async (event: Electron.IpcMainInvokeEvent) => {
        return new Promise(resolve => {
            new ProjectMenu(getProject(event), event.sender)
                .after(() => {
                    resolve()
                })
                .open()
        })
    })

ipcMain
    .handle('repository-add', async (event: Electron.IpcMainInvokeEvent, paths: Array<string>) => {
        const project: IProject = getProject(event)
        const repositories = await Promise.all(paths.map(path => {
            return project.addRepository({ path })
        }))
        project.emitRepositoriesToRenderer()
        return repositories.map(repository => repository.render())
    })

ipcMain
    .handle('repository-scan', async (event: Electron.IpcMainInvokeEvent, repositoryId: string) => {
        const repository: IRepository = await getRepository(event, repositoryId)
        const pending: Array<FrameworkOptions> = await repository.scan()
        return pending
    })

ipcMain
    .handle('repository-validate', async (event: Electron.IpcMainInvokeEvent, options: PotentialRepositoryOptions) => {
        const project: IProject = getProject(event)
        const validator = new RepositoryValidator(project.repositories.map((repository: IRepository) => repository.getPath()))
        return validator.validate(options).getErrors()
    })

ipcMain
    .handle('repository-frameworks', async (event: Electron.IpcMainInvokeEvent, repositoryId: string) => {
        return (await getRepository(event, repositoryId)).frameworks.map(framework => framework.render())
    })

ipcMain
    .handle('repository-exists', async (event: Electron.IpcMainInvokeEvent, repositoryId: string) => {
        return (await getRepository(event, repositoryId)).exists()
    })

ipcMain
    .handle('repository-locate', async (event: Electron.IpcMainInvokeEvent, repositoryId: string) => {
        return (await getRepository(event, repositoryId)).locate(currentWindow!.getChild())
    })

ipcMain
    .handle('repository-context-menu', async (event: Electron.IpcMainInvokeEvent, repositoryId: string) => {
        const repository: IRepository = await getRepository(event, repositoryId)
        return new Promise(resolve => {
            new RepositoryMenu(repository, event.sender)
                .after(() => {
                    resolve()
                })
                .open()
        })
    })

ipcMain
    .handle('framework-types', async (event: Electron.IpcMainInvokeEvent) => {
        return Frameworks.map(framework => {
            return {
                ...framework.getDefaults(),
                instructions: framework.instructions()
            }
        })
    })

ipcMain
    .handle('framework-get', async (event: Electron.IpcMainInvokeEvent, frameworkId: string) => {
        const { framework } = await entities(event, frameworkId)
        return framework.render()
    })

ipcMain
    .handle('framework-get-ledger', async (event: Electron.IpcMainInvokeEvent, frameworkId: string) => {
        const { framework } = await entities(event, frameworkId)
        return {
            ledger: framework.getLedger(),
            status: framework.getStatusMap()
        }
    })

ipcMain
    .handle('framework-validate', async (event: Electron.IpcMainInvokeEvent, repositoryId: string, options: PotentialFrameworkOptions) => {
        const repository: IRepository = await getRepository(event, repositoryId)
        const validator = new FrameworkValidator(repository.getPath())
        return validator.validate(options).getErrors()
    })

ipcMain
    .handle('framework-autoload-path-menu', async (event: Electron.IpcMainInvokeEvent, defaultPath: string) => {
        return (await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            properties: ['openFile'],
            defaultPath
        })).filePaths
    })

ipcMain
    .handle('framework-tests-path-menu', async (event: Electron.IpcMainInvokeEvent, defaultPath: string) => {
        return (await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            properties: ['createDirectory', 'openDirectory'],
            defaultPath
        })).filePaths
    })

ipcMain
    .handle('framework-identity-menu', async (event: Electron.IpcMainInvokeEvent) => {
        return (await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            properties: ['openFile', 'showHiddenFiles'],
            message: 'Choose a custom SSH key file to use with this connection.\nNote that ~/.ssh/id_rsa and identities defined in your SSH configuration are included by default.'
        })).filePaths
    })

ipcMain
    .handle('framework-context-menu', async (event: Electron.IpcMainInvokeEvent, frameworkId: string, rect?: DOMRect) => {
        const { repository, framework } = await entities(event, frameworkId)
        return new Promise(resolve => {
            new FrameworkMenu(repository, framework, event.sender)
                .attachTo(rect)
                .after(() => {
                    resolve()
                })
                .open()
        })
    })

ipcMain
    .handle('test-get', async (event: Electron.IpcMainInvokeEvent, frameworkId: string, identifiers: Array<string>) => {
        try {
            const { repository, framework, nuggets, nugget } = await entities(event, frameworkId, identifiers)
            return {
                repository: repository.render(),
                framework: framework.render(),
                nuggets: nuggets!.map((nugget: Nugget) => nugget.render(false)),
                nugget: nugget!.render(false)
            }
        } catch (_) {
            // If any entity is not found while trying to load a test, assume
            // something's been removed and force the user to select one again.
            return {
                framework: null,
                nuggets: null
            }
        }
    })

ipcMain
    .handle('file-context-menu', async (event: Electron.IpcMainInvokeEvent, filePath: string) => {
        return new Promise(resolve => {
            new FileMenu(filePath, event.sender)
                .after(() => {
                    resolve()
                })
                .open()
        })
    })

ipcMain
    .handle('terms', async (event: Electron.IpcMainInvokeEvent) => {
        return Fs.readFileSync(Path.join(__static, '/LICENSE'), 'utf8') || ''
    })

ipcMain
    .handle('licenses', async (event: Electron.IpcMainInvokeEvent) => {
        return Fs.readFileSync(Path.join(__static, '/licenses.json'), 'utf8')
    })

ipcMain
    .handle('log-project', async (event: Electron.IpcMainInvokeEvent) => {
        const project: IProject = getProject(event)
        const projectState = state.project({ id: project.getId() })
        return stringify({
            project: {
                object: project,
                string: stringify(project)
            },
            state: {
                json: projectState.get(),
                string: stringify(projectState.get())
            }
        })
    })

ipcMain
    .handle('log-settings', async (event: Electron.IpcMainInvokeEvent) => {
        return stringify({
            object: state.get(),
            string: stringify(state.get())
        })
    })
