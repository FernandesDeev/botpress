import actions from './actions'
import { register, unregister, handler } from './setup'
import * as botpress from '.botpress'

console.info('starting integration')

export default new botpress.Integration({
  register,
  unregister,
  actions,
  handler,
  channels: {},
})
