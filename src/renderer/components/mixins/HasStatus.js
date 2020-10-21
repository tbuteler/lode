import { ipcRenderer } from 'electron'

export default {
    data () {
        return {
            status: this.model.status || 'idle'
        }
    },
    computed: {
        identifier () {
            return this.model.id || this.model.file
        }
    },
    created () {
        // @TODO: check frameworks being instantiated twice when switching in sidebar
        // console.log('created')
        ipcRenderer.on(`${this.identifier}:status`, this.statusListener)
    },
    destroyed () {
        ipcRenderer.removeListener(`${this.identifier}:status`, this.statusListener)
    },
    methods: {
        statusListener (event, payload) {
            this.$payload(payload, (to, from) => {
                this.status = to
                this.$emit('status', to, from, this.model)
            })
        }
    }
}
