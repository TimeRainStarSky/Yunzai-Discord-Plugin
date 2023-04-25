logger.info(logger.yellow("- 正在加载 Discord 插件"))

import { config, configSave } from "./Model/config.js"
import Eris from "eris"
import ProxyAgent from "proxy-agent"
const agent = new ProxyAgent(config.proxy)

async function makeBuffer(file) {
  if (file.match(/^base64:\/\//))
    return Buffer.from(file.replace(/^base64:\/\//, ""), "base64")
  else if (file.match(/^https?:\/\//))
    return Buffer.from(await (await fetch(file)).arrayBuffer())
  else
    return file
}

async function sendMsg(data, msg) {
  if (!Array.isArray(msg))
    msg = [msg]
  let msgs = ""
  let content = ""
  const file = []
  for (let i of msg)
    switch (i.type) {
      case "text":
        content += i.data.text
        break
      case "image":
        msgs += `[图片：${i.data.file.replace(/^base64:\/\/.*/, "base64://...")}]`
        file.push({ name: "image.png", file: await makeBuffer(i.data.file) })
        break
      case "record":
        msgs += `[音频：${i.data.file.replace(/^base64:\/\/.*/, "base64://...")}]`
        file.push({ name: "audio.mp3", file: await makeBuffer(i.data.file) })
        break
      case "video":
        msgs += `[视频：${i.data.file.replace(/^base64:\/\/.*/, "base64://...")}]`
        file.push({ name: "video.mp4", file: await makeBuffer(i.data.file) })
        break
      case "reply":
        break
      case "at":
        break
      default:
        if (typeof i == "object")
          i = JSON.stringify(i)
        content += i
    }
  logger.info(`${logger.blue(`[${data.self_id}]`)} 发送消息：[${data.id}] ${content}${msgs}`)
  return data.bot.createMessage(data.id, content, file)
}

function makeMessage(data) {
  data.user_id = `dc_${data.author.id}`
  data.sender = {
    nickname: data.author.username
  }
  data.post_type = "message"

  const message = []
  if (data.content)
    message.push({ type: "text", text: data.content })
  data.message = message

  if (data.guildID) {
    data.message_type = "group"
    data.group_id = `dc_${data.channel.id}`
    data.group_name = data.channel.name
    if (!Bot[data.self_id].gl.has(data.group_id))
      Bot[data.self_id].gl.set(data.group_id, data.channel)

    logger.info(`${logger.blue(`[${data.self_id}]`)} 群消息：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})] ${JSON.stringify(data.message)}`)
    data.friend = data.bot.pickFriend(data.user_id)
    data.group = data.bot.pickGroup(data.group_id)
    data.member = data.group.pickMember(data.user_id)
  } else {
    data.message_type = "private"
    if (!Bot[data.self_id].fl.has(data.user_id))
      Bot[data.self_id].fl.set(data.user_id, data.channel)

    logger.info(`${logger.blue(`[${data.self_id}]`)} 好友消息：[${data.sender.nickname}(${data.user_id})] ${JSON.stringify(data.message)}`)
    data.friend = data.bot.pickFriend(data.user_id)
  }

  Bot.emit(`${data.post_type}.${data.message_type}`, data)
  Bot.emit(`${data.post_type}`, data)
}

async function makeForwardMsg(data, msg) {
  const messages = []
  for (const i of msg)
    messages.push(await sendMsg(data, i.message))
  messages.data = "消息"
  return messages
}

async function connectBot(token) {
  const bot = new Eris(`Bot ${token}`, {
    intents: ["all"],
    ws: { agent },
    rest: { agent, ...config.reverseProxy ? { domain: config.reverseProxy }:{}}
  })
  bot.on("error", logger.error)

  bot.connect()
  await new Promise(resolve => bot.once("ready", () => resolve()))

  if (!bot.user.id) {
    logger.error(`${logger.blue(`[${token}]`)} DiscordBot 连接失败`)
    bot.disconnect()
    return false
  }

  const id = `dc_${bot.user.id}`
  Bot[id] = bot
  Bot[id].info = Bot[id].user
  Bot[id].uin = id
  Bot[id].nickname = Bot[id].info.username
  Bot[id].version = {
    impl: "DiscordBot",
    version: config.package.dependencies["eris"],
    onebot_version: "v11",
  }
  Bot[id].stat = { start_time: Bot[id].startTime/1000 }
  Bot[id].fl = new Map()
  Bot[id].gl = new Map()

  Bot[id].pickFriend = user_id => {
    const i = {
      self_id: id,
      bot: Bot[id],
      id: Bot[id].fl.get(user_id)?.id ?? user_id.replace(/^dc_/, ""),
    }
    return {
      sendMsg: msg => sendMsg(i, msg),
      recallMsg: () => false,
      makeForwardMsg: msg => makeForwardMsg(i, msg),
    }
  }
  Bot[id].pickUser = Bot[id].pickFriend

  Bot[id].pickMember = (group_id, user_id) => {
    const i = {
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(/^dc_/, ""),
      user_id: Bot[id].fl.get(user_id)?.id ?? user_id.replace(/^dc_/, ""),
    }
    return {
      ...Bot[id].pickFriend(user_id),
    }
  },

  Bot[id].pickGroup = group_id => {
    const i = {
      self_id: id,
      bot: Bot[id],
      id: group_id.replace(/^dc_/, ""),
    }
    return {
      sendMsg: msg => sendMsg(i, msg),
      recallMsg: () => false,
      makeForwardMsg: msg => makeForwardMsg(i, msg),
      pickMember: user_id => i.bot.pickMember(i.id, user_id),
    }
  }

  if (Array.isArray(Bot.uin)) {
    if (!Bot.uin.includes(id))
      Bot.uin.push(id)
  } else {
    Bot.uin = [id]
  }

  bot.on("messageCreate", data => {
    data.self_id = id
    data.bot = Bot[id]
    makeMessage(data)
  })

  logger.mark(`${logger.blue(`[${id}]`)} DiscordBot 已连接`)
  Bot.emit(`connect.${id}`, Bot[id])
  Bot.emit(`connect`, Bot[id])
  return true
}

Bot.once("online", async () => {
  for (const token of config.token)
    await connectBot(token)
})

export class Discord extends plugin {
  constructor () {
    super({
      name: "Discord",
      dsc: "Discord",
      event: "message",
      rule: [
        {
          reg: "^#[Dd][Cc]账号$",
          fnc: "List",
          permission: "master"
        },
        {
          reg: "^#[Dd][Cc]设置.+$",
          fnc: "Token",
          permission: "master"
        },
        {
          reg: "^#[Dd][Cc](代理|反代)",
          fnc: "Proxy",
          permission: "master"
        }
      ]
    })
  }

  async List () {
    await this.reply(`共${config.token.length}个账号：\n${config.token.join("\n")}`, true)
  }

  async Token () {
    let token = this.e.msg.replace(/^#[Dd][Cc]设置/, "").trim()
    if (config.token.includes(token)) {
      config.token = config.token.filter(item => item != token)
      await this.reply(`账号已删除，重启后生效，共${config.token.length}个账号`, true)
    } else {
      if (await connectBot(token)) {
        config.token.push(token)
        await this.reply(`账号已连接，共${config.token.length}个账号`, true)
      } else {
        await this.reply(`账号连接失败`, true)
        return false
      }
    }
    configSave(config)
  }

  async Proxy () {
    let proxy = this.e.msg.replace(/^#[Dd][Cc](代理|反代)/, "").trim()
    if (this.e.msg.match("代理")) {
      config.proxy = proxy
      await this.reply(`代理已${proxy?"设置":"删除"}，重启后生效`, true)
    } else {
      config.reverseProxy = proxy
      await this.reply(`反代已${proxy?"设置":"删除"}，重启后生效`, true)
    }
    configSave(config)
  }
}

logger.info(logger.green("- Discord 插件 加载完成"))