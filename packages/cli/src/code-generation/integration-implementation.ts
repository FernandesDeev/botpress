import * as bpsdk from '@botpress/sdk'
import { z } from 'zod'
import * as utils from '../utils'
import { GENERATED_HEADER, INDEX_FILE } from './const'
import { stringifySingleLine } from './generators'
import { ActionsModule } from './integration-schemas/actions-module'
import { ChannelsModule } from './integration-schemas/channels-module'
import { ConfigurationModule } from './integration-schemas/configuration-module'
import { EventsModule } from './integration-schemas/events-module'
import { StatesModule } from './integration-schemas/states-module'
import { Module, ModuleDef } from './module'
import * as types from './typings'

export class IntegrationImplementationIndexModule extends Module {
  public static async create(
    sdkIntegration: bpsdk.IntegrationDefinition
  ): Promise<IntegrationImplementationIndexModule> {
    const integration = this._mapIntegration(sdkIntegration)

    const configModule = await ConfigurationModule.create(integration.configuration ?? { schema: {} })
    configModule.unshift('configuration')

    const actionsModule = await ActionsModule.create(integration.actions ?? {})
    actionsModule.unshift('actions')

    const channelsModule = await ChannelsModule.create(integration.channels ?? {})
    channelsModule.unshift('channels')

    const eventsModule = await EventsModule.create(integration.events ?? {})
    eventsModule.unshift('events')

    const statesModule = await StatesModule.create(integration.states ?? {})
    statesModule.unshift('states')

    const inst = new IntegrationImplementationIndexModule(
      integration,
      configModule,
      actionsModule,
      channelsModule,
      eventsModule,
      statesModule,
      {
        path: INDEX_FILE,
        exportName: 'Integration',
        content: '',
      }
    )

    inst.pushDep(configModule)
    inst.pushDep(actionsModule)
    inst.pushDep(channelsModule)
    inst.pushDep(eventsModule)
    inst.pushDep(statesModule)
    return inst
  }

  private constructor(
    private integration: types.IntegrationDefinition,
    private configModule: ConfigurationModule,
    private actionsModule: ActionsModule,
    private channelsModule: ChannelsModule,
    private eventsModule: EventsModule,
    private statesModule: StatesModule,
    def: ModuleDef
  ) {
    super(def)
  }

  public override get content(): string {
    let content = GENERATED_HEADER

    const { configModule, actionsModule, channelsModule, eventsModule, statesModule, integration } = this

    const configImport = configModule.import(this)
    const actionsImport = actionsModule.import(this)
    const channelsImport = channelsModule.import(this)
    const eventsImport = eventsModule.import(this)
    const statesImport = statesModule.import(this)

    content += [
      GENERATED_HEADER,
      'import * as sdk from "@botpress/sdk"',
      '',
      `import type * as ${configModule.name} from "./${configImport}"`,
      `import type * as ${actionsModule.name} from "./${actionsImport}"`,
      `import type * as ${channelsModule.name} from "./${channelsImport}"`,
      `import type * as ${eventsModule.name} from "./${eventsImport}"`,
      `import type * as ${statesModule.name} from "./${statesImport}"`,
      `export * as ${configModule.name} from "./${configImport}"`,
      `export * as ${actionsModule.name} from "./${actionsImport}"`,
      `export * as ${channelsModule.name} from "./${channelsImport}"`,
      `export * as ${eventsModule.name} from "./${eventsImport}"`,
      `export * as ${statesModule.name} from "./${statesImport}"`,
      '',
      'type TIntegration = {',
      `  name: "${integration.name}"`,
      `  version: "${integration.version}"`,
      `  configuration: ${configModule.name}.${configModule.exports}`,
      `  actions: ${actionsModule.name}.${actionsModule.exports}`,
      `  channels: ${channelsModule.name}.${channelsModule.exports}`,
      `  events: ${eventsModule.name}.${eventsModule.exports}`,
      `  states: ${statesModule.name}.${statesModule.exports}`,
      `  user: ${stringifySingleLine(integration.user)}`,
      '}',
      '',
      'export type IntegrationProps = sdk.IntegrationProps<TIntegration>',
      '',
      'export class Integration extends sdk.Integration<TIntegration> {}',
      '',
      'export type Client = sdk.IntegrationSpecificClient<TIntegration>',
    ].join('\n')

    return content
  }

  private static _mapIntegration = (i: bpsdk.IntegrationDefinition): types.IntegrationDefinition => ({
    name: i.name,
    version: i.version,
    user: {
      tags: i.user?.tags ?? {},
      creation: i.user?.creation ?? { enabled: false, requiredTags: [] },
    },
    configuration: i.configuration ? this._mapSchema(i.configuration) : { schema: {} },
    events: i.events ? utils.records.mapValues(i.events, this._mapSchema) : {},
    states: i.states ? utils.records.mapValues(i.states, this._mapSchema) : {},
    actions: i.actions
      ? utils.records.mapValues(i.actions, (a) => ({
          input: this._mapSchema(a.input),
          output: this._mapSchema(a.output),
        }))
      : {},
    channels: i.channels
      ? utils.records.mapValues(i.channels, (c) => ({
          conversation: {
            tags: c.conversation?.tags ?? {},
            creation: c.conversation?.creation ?? { enabled: false, requiredTags: [] },
          },
          message: {
            tags: c.message?.tags ?? {},
          },
          messages: utils.records.mapValues(c.messages, this._mapSchema),
        }))
      : {},
  })

  private static _mapSchema = <T extends { schema: z.ZodObject<any> }>(
    x: T
  ): utils.types.Merge<T, { schema: ReturnType<typeof utils.schema.mapZodToJsonSchema> }> => ({
    ...x,
    schema: utils.schema.mapZodToJsonSchema(x),
  })
}
