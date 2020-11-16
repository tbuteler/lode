import { get, omit } from 'lodash'
import { ApplicationWindow } from '@main/application-window'
import { Status } from '@lib/frameworks/status'
import { Nugget } from '@lib/frameworks/nugget'

export interface ITest extends Nugget {
    selected: boolean

    getId (): string
    getStatus (): Status
    getName (): string
    getDisplayName (): string
    toggleSelected (toggle?: boolean, cascade?: boolean): Promise<void>
    toggleExpanded (toggle?: boolean, cascade?: boolean): Promise<void>
    render (status?: Status | false): ITestResult
    persist (status?: Status | false): ITestResult
    resetResult (): void
    idle (selective: boolean): Promise<void>
    queue (selective: boolean): Promise<void>
    error (selective: boolean): Promise<void>
    idleQueued (selective: boolean): void
    errorQueued (selective: boolean): void
    debrief (result: ITestResult, cleanup: boolean): Promise<void>
    countChildren (): number
    hasChildren(): boolean
    contextMenu (): Array<Electron.MenuItemConstructorOptions>
}

export interface ITestResult {
    id: string
    name: string
    displayName?: string | null
    status: Status
    feedback?: string | object
    console?: Array<any>
    params?: string
    stats?: object
    isLast?: boolean
    tests?: Array<ITestResult>
    hasChildren?: boolean
}

export class Test extends Nugget implements ITest {
    protected status!: Status
    protected result!: ITestResult

    constructor (window: ApplicationWindow, result: ITestResult) {
        super(window)
        this.build(result, false)
    }

    /**
     * Prepares the test for sending out to renderer process.
     *
     * @param status Which status to recursively set on tests. False will persist current status.
     */
    public render (status: Status | false = 'idle'): ITestResult {
        return omit({
            ...this.defaults(this.result, status),
            hasChildren: this.hasChildren(),
            selected: this.selected,
            partial: this.partial
        }, 'tests')
    }

    /**
     * Prepare this test for persistence.
     *
     * @param status Which status to recursively set on tests. False will persist current status.
     */
    public persist (status: Status | false = 'idle'): ITestResult {
        return this.defaults(this.result, status)
    }

    /**
     * Reset this test's result (i.e. remove feedback etc, as if the
     * test never ran, but persist its identifying data).
     */
    public resetResult (): void {
        this.result = this.defaults(this.result)
    }

    /**
     * Build this test from a result object.
     *
     * @param result The result object with which to build this test.
     * @param cleanup Whether to clean obsolete children after building.
     */
    protected build (result: ITestResult, cleanup: boolean): void {
        // We allow result status to be empty from reporters, but we'll
        // amend them before building the actual test.
        result.status = this.getRecursiveStatus(result)
        this.result = this.mergeResults(result)
        this.updateStatus(result.status || 'idle')
        if (result.tests && result.tests.length) {
            this.debriefTests(result.tests, cleanup)
        }
    }

    /**
     * Merge new tests results with existing ones. Useful for persisting
     * some properties which are inherent to a test (e.g. first seen date).
     *
     * @param result The result object with which to build this test.
     */
    protected mergeResults (result: ITestResult): ITestResult {
        // If result already has the "first seen" property, it's likely the test
        // being persisted from store, in which case we'll let that date prevail.
        if (get(result, 'stats.first')) {
            return result
        }
        // Otherwise, set the "first seen" date according to current existing
        // result or the current date and time (i.e. it's a new test).
        result.stats = {
            ...(result.stats || {}),
            ...{
                first: get(this.result || {}, 'stats.first', new Date().toISOString())
            }
        }

        return result
    }

    /**
     * Instantiate a new test.
     *
     * @param result The test result with which to instantiate a new test.
     */
    protected newTest (result: ITestResult): ITest {
        return new Test(this.window, result)
    }

    /**
     * Get this test's id.
     */
    public getId (): string {
        return this.result.id!
    }

    /**
     * Get this test's display name.
     */
    public getName (): string {
        return this.result.name
    }

    /**
     * Get this test's display name.
     */
    public getDisplayName (): string {
        return this.result.displayName || this.getName()
    }

    /**
     * Debrief this test.
     *
     * @param result The result object with which to debrief this test.
     * @param cleanup Whether to clean obsolete children after debriefing.
     */
    public debrief (result: ITestResult, cleanup: boolean): Promise<void> {
        // Amend result stats with last run date and time (i.e. now)
        result.stats = { ...(result.stats || {}), ...{ last: new Date().toISOString() }}
        return new Promise((resolve, reject) => {
            this.build(result, cleanup)
            this.emit('debriefed')
            resolve()
        })
    }
}
