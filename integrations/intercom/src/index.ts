import type { Conversation } from '@botpress/client'
import type { AckFunction } from '@botpress/sdk'
import { sentry as sentryHelpers } from '@botpress/sdk-addons'
import { Client, ReplyToConversationMessageType } from 'intercom-client'
import { z } from 'zod'
import * as html from './html.utils'
import { Integration, secrets } from '.botpress'
import type * as botpress from '.botpress'

type Card = botpress.channels.channel.card.Card
type Location = botpress.channels.channel.location.Location
type Configuration = botpress.configuration.Configuration

sentryHelpers.init({
  dsn: secrets.SENTRY_DSN,
  environment: secrets.SENTRY_ENVIRONMENT,
  release: secrets.SENTRY_RELEASE,
})

const log = console

const conversationPartSchema = z.object({
  type: z.literal('conversation_part'),
  id: z.string(),
  author: z.object({
    id: z.string(),
    type: z.string(),
  }),
  body: z.string().nullable(),
})

const conversationSourceSchema = z.object({
  id: z.string(),
  author: z.object({
    id: z.string(),
    type: z.string(),
  }),
  body: z.string().nullable(),
})

type IntercomMessage = {
  id: string
  author: {
    id: string
    type: string
  }
  body: string | null
}

const conversationSchema = z.object({
  type: z.literal('conversation'),
  admin_assignee_id: z
    .number()
    .nullable()
    .transform((val) => (val ? val.toString() : null)),
  id: z.string(),
  source: conversationSourceSchema,
  conversation_parts: z.object({
    conversation_parts: z.array(conversationPartSchema),
  }),
})

const webhookNotificationSchema = z.object({
  type: z.literal('notification_event'),
  topic: z.string(),
  data: z.object({
    item: conversationSchema,
  }),
})

const integration = new Integration({
  register: async () => {},
  unregister: async () => {},
  actions: {},
  channels: {
    channel: {
      messages: {
        text: async ({ payload, conversation, ack, ctx }) => {
          await sendMessage({
            body: payload.text,
            conversation,
            configuration: ctx.configuration,
            ack,
          })
        },
        image: async ({ payload, ctx, conversation, ack }) => {
          await sendMessage({
            body: '',
            conversation,
            configuration: ctx.configuration,
            ack,
            attachmentUrls: [payload.imageUrl],
          })
        },
        markdown: async ({ ctx, conversation, ack, payload }) => {
          await sendMessage({
            body: payload.markdown,
            conversation,
            configuration: ctx.configuration,
            ack,
          })
        },
        audio: async ({ ctx, conversation, ack, payload }) => {
          await sendMessage({
            body: '',
            conversation,
            configuration: ctx.configuration,
            ack,
            attachmentUrls: [payload.audioUrl],
          })
        },
        video: async ({ ctx, conversation, ack, payload }) => {
          await sendMessage({
            body: '',
            conversation,
            configuration: ctx.configuration,
            ack,
            attachmentUrls: [payload.videoUrl],
          })
        },
        file: async ({ ctx, conversation, ack, payload }) => {
          await sendMessage({
            body: '',
            conversation,
            configuration: ctx.configuration,
            ack,
            attachmentUrls: [payload.fileUrl],
          })
        },
        location: async ({ ctx, conversation, ack, payload }) => {
          await sendMessage({
            body: formatGoogleMapLink(payload),
            conversation,
            configuration: ctx.configuration,
            ack,
          })
        },
        carousel: async ({ ctx, conversation, ack, payload }) => {
          const carousel = payload.items.map((card) => createCard(card)).join('')

          await sendMessage({
            body: carousel,
            conversation,
            configuration: ctx.configuration,
            ack,
          })
        },
        card: async ({ ctx, conversation, ack, payload }) => {
          await sendMessage({
            body: createCard(payload),
            conversation,
            configuration: ctx.configuration,
            ack,
          })
        },
        dropdown: async ({ ctx, conversation, ack, payload }) => {
          const choices = payload.options.map((choice) => html.li(choice.value))

          const message = composeMessage(
            html.p(payload.text),
            html.p('Type one of the following options:'),
            choices.length > 0 ? html.ol(choices.join('')) : ''
          )

          await sendMessage({
            body: message,
            conversation,
            configuration: ctx.configuration,
            ack,
          })
        },
        choice: async ({ ctx, conversation, ack, payload }) => {
          const choices = payload.options.map((choice) => html.li(choice.value))

          const message = composeMessage(
            html.p(payload.text),
            html.p('Type one of the following options:'),
            choices.length > 0 ? html.ol(choices.join('')) : ''
          )

          await sendMessage({
            body: message,
            conversation,
            configuration: ctx.configuration,
            ack,
          })
        },
      },
    },
  },
  handler: async ({ req, client, ctx }) => {
    log.info('Handler received request')

    if (!req.body) {
      log.warn('Handler received an empty body')
      return
    }
    const parsedBody = webhookNotificationSchema.safeParse(await JSON.parse(req.body))

    if (!parsedBody.success) {
      log.warn(`Handler received an invalid body: ${parsedBody.error}`)
      return
    }

    if (parsedBody.data.topic === 'conversation.admin.replied') {
      return // ignore admin replies, since the bot is an admin we don't want to reply to ourselves
    }

    const {
      data: {
        item: {
          id: conversationId,
          admin_assignee_id: adminAssigneeId,
          conversation_parts: { conversation_parts },
          source: firstConversationPart,
        },
      },
    } = parsedBody.data

    if (ctx.configuration.adminId !== adminAssigneeId) {
      return // ignore conversations not assigned to the bot
    }

    if (!conversationId) {
      throw new Error('Handler received an conversation id')
    }

    const { conversation } = await client.getOrCreateConversation({
      channel: 'channel',
      tags: {
        ['intercom:id']: `${conversationId}`,
      },
    })

    // this uses the message payload from intercom to create the message in the bot
    const createMessage = async (intercomMessage: IntercomMessage) => {
      const {
        author: { id: authorId, type: authorType },
        body,
        id: messageId,
      } = intercomMessage

      if (!messageId) {
        throw new Error('Handler received an empty message id')
      }

      if (!body) {
        return // ignore no body messages
      }

      if (authorType === 'bot') {
        log.info(`Handler received a bot message with id ${messageId}`)
        return // ignore bot messages
      }

      const { user } = await client.getOrCreateUser({
        tags: {
          ['intercom:id']: `${authorId}`,
        },
      })

      await client.createMessage({
        tags: { ['intercom:id']: `${messageId}` },
        type: 'text',
        userId: user.id,
        conversationId: conversation.id,
        payload: { text: html.stripTags(body) },
      })
    }

    if (parsedBody.data.topic === 'conversation.user.created') {
      await createMessage(firstConversationPart) // important, intercom keeps the first message in a separate object
    }

    for (const part of conversation_parts) {
      await createMessage(part)
    }
    log.info('Handler finished processing request')

    return
  },
  createUser: async ({ client, tags, ctx }) => {
    const userId = tags['intercom:id']

    if (!userId) {
      return
    }

    const intercomClient = new Client({ tokenAuth: { token: ctx.configuration.accessToken } })
    const contact = await intercomClient.contacts.find({ id: userId })

    const { user } = await client.getOrCreateUser({ tags: { 'intercom:id': `${contact.id}` } })

    return {
      body: JSON.stringify({ user: { id: user.id } }),
      headers: {},
      statusCode: 200,
    }
  },
  createConversation: async ({ client, channel, tags, ctx }) => {
    const conversationId = tags['intercom:id']

    if (!conversationId) {
      return
    }

    const intercomClient = new Client({ tokenAuth: { token: ctx.configuration.accessToken } })
    const chat = await intercomClient.conversations.find({ id: conversationId })

    const { conversation } = await client.getOrCreateConversation({
      channel,
      tags: { 'intercom:id': `${chat.id}` },
    })

    return {
      body: JSON.stringify({ conversation: { id: conversation.id } }),
      headers: {},
      statusCode: 200,
    }
  },
})

export default sentryHelpers.wrapIntegration(integration)

async function sendMessage(props: {
  body: string
  conversation: Conversation
  ack: AckFunction
  configuration: Configuration
  attachmentUrls?: string[]
}) {
  const { body, attachmentUrls, configuration, conversation, ack } = props
  const client = new Client({ tokenAuth: { token: configuration.accessToken } })

  const {
    conversation_parts: { conversation_parts: conversationParts },
  } = await client.conversations.replyByIdAsAdmin({
    id: conversation.tags['intercom:id'] ?? '',
    adminId: configuration.adminId,
    messageType: ReplyToConversationMessageType.COMMENT,
    body,
    attachmentUrls,
  })

  await ack({ tags: { ['intercom:id']: `${conversationParts.at(-1)?.id ?? ''}` } })
}

function composeMessage(...parts: string[]) {
  return parts.join('')
}

function createCard({ title, subtitle, imageUrl, actions }: Card) {
  const image = imageUrl ? html.img(imageUrl) : ''
  const text = html.b(title) + html.p(subtitle ? subtitle : '')

  const links = actions.filter((item) => item.action === 'url').map((item) => html.li(html.a(item.value, item.label)))

  const choices = actions
    .filter((item) => item.action !== 'url')
    .map((item) => html.li(item.value))
    .join('')

  return composeMessage(
    image,
    text,
    links.length > 0 ? html.ul(links.join('')) : '',
    html.p('Type one of the following options:'),
    html.ol(choices)
  )
}

function formatGoogleMapLink(payload: Location) {
  return `https://www.google.com/maps/search/?api=1&query=${payload.latitude},${payload.longitude}`
}
