import _has from 'lodash/has'

export default {
    namespaced: true,
    state: {
        modals: []
    },
    mutations: {
        ADD (state, payload) {
            state.modals.push(payload)
        },
        REMOVE (state) {
            const modal = state.modals.pop()
            if (_has(modal, 'callback') && modal.callback) {
                modal.callback.call()
            }
        },
        CLEAR (state) {
            state.modals = []
        }
    },
    actions: {
        open: ({ state, commit, dispatch, getters }, payload) => {
            commit('ADD', payload)
            dispatch('change')
        },
        close: ({ state, commit, dispatch }) => {
            commit('REMOVE')
            dispatch('change')
        },
        clear: ({ state, commit, dispatch }) => {
            commit('CLEAR')
            dispatch('change')
        },
        change: ({ state, commit }) => {
            if (state.modals.length) {
                document.body.classList.add('modal-open')
                return
            }
            document.body.classList.remove('modal-open')
        }
    },
    getters: {
        hasModals: (state) => {
            return state.modals.length > 0
        },
        modals: (state) => {
            return state.modals
        }
    }
}