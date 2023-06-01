logger.info(logger.yellow("- 正在加载 Discord 插件"))

import { config, configSave } from "./Model/config.js"
import fetch from "node-fetch"
import Eris from "eris"
import { HttpsProxyAgent } from "https-proxy-agent"

const adapter = new class DiscordAdapter {
  async makeBuffer(file) {
    if (file.match(/^base64:\/\//))
      return Buffer.from(file.replace(/^base64:\/\//, ""), "base64")
    else if (file.match(/^https?:\/\//))
      return Buffer.from(await (await fetch(file)).arrayBuffer())
    else
      return file
  }

  async sendMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    let msgs = ""
    let content = ""
    const file = []
    for (let i of msg) {
      if (typeof i != "object")
        i = { type: "text", data: { text: i }}
      else if (!i.data)
        i = { type: i.type, data: { ...i, type: undefined }}
      switch (i.type) {
        case "text":
          content += i.data.text
          break
        case "image":
          msgs += `[图片：${i.data.file.replace(/^base64:\/\/.*/, "base64://...")}]`
          file.push({ name: "image.png", file: await this.makeBuffer(i.data.file) })
          break
        case "record":
          msgs += `[音频：${i.data.file.replace(/^base64:\/\/.*/, "base64://...")}]`
          file.push({ name: "audio.mp3", file: await this.makeBuffer(i.data.file) })
          break
        case "video":
          msgs += `[视频：${i.data.file.replace(/^base64:\/\/.*/, "base64://...")}]`
          file.push({ name: "video.mp4", file: await this.makeBuffer(i.data.file) })
          break
        case "reply":
          break
        case "at":
          if (i.data.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.data.qq}>`
          break
        default:
          i = JSON.stringify(i)
          content += i
      }
    }
    logger.info(`${logger.blue(`[${data.self_id}]`)} 发送消息：[${data.id}] ${content}${msgs}`)
    return data.bot.createMessage(data.id, content, file)
  }

  async sendFriendMsg(data, msg) {
    data.id = (await data.bot.getDMChannel(data.user_id)).id
    return this.sendMsg(data, msg)
  }

  async getAvatarUrl(data) {
    return data.bot.fl.get(data.user_id)?.avatarURL || (await data.bot.getDMChannel(data.user_id)).recipient.avatarURL
  }

  makeMessage(data) {
    data.user_id = `dc_${data.author.id}`
    data.sender = {
      nickname: data.author.username,
      avatar: data.author.avatarURL,
    }
    data.post_type = "message"

    data.message = []
    data.raw_message = ""
    if (data.content) {
      data.message.push({ type: "text", text: data.content })
      data.raw_message += data.content
    }

    if (!Bot[data.self_id].fl.has(data.user_id))
      Bot[data.self_id].fl.set(data.user_id, data.author)

    if (data.guildID) {
      data.message_type = "group"
      data.group_id = `dc_${data.channel.id}`
      data.group_name = data.channel.name
      if (!Bot[data.self_id].gl.has(data.group_id))
        Bot[data.self_id].gl.set(data.group_id, data.channel)

      logger.info(`${logger.blue(`[${data.self_id}]`)} 群消息：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`)
      data.friend = data.bot.pickFriend(data.user_id)
      data.group = data.bot.pickGroup(data.group_id)
      data.member = data.group.pickMember(data.user_id)
    } else {
      data.message_type = "private"
      logger.info(`${logger.blue(`[${data.self_id}]`)} 好友消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`)
      data.friend = data.bot.pickFriend(data.user_id)
    }

    Bot.emit(`${data.post_type}.${data.message_type}`, data)
    Bot.emit(`${data.post_type}`, data)
  }

  async makeForwardMsg(data, msg) {
    const messages = []
    for (const i of msg)
      messages.push(await this.sendMsg(data, i.message))
    messages.data = "消息"
    return messages
  }

  async connect(token) {
    const args = {
      intents: ["all"],
      ws: {},
      rest: {},
    }

    if (config.proxy) {
      args.ws.agent = new HttpsProxyAgent(config.proxy)
      args.rest.agent = args.ws.agent
    }

    if (config.reverseProxy)
      args.rest.domain = config.reverseProxy

    const bot = new Eris(`Bot ${token}`, args)
    bot.on("error", logger.error)
    bot.connect()
    await new Promise(resolve => bot.once("ready", resolve))

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
    Bot[id].avatar = Bot[id].info.avatarURL
    Bot[id].version = {
      impl: "DiscordBot",
      version: config.package.dependencies.eris,
      onebot_version: "v11",
    }
    Bot[id].stat = { start_time: Bot[id].startTime/1000 }
    Bot[id].fl = new Map()
    Bot[id].gl = new Map()

    Bot[id].pickFriend = user_id => {
      const i = {
        self_id: id,
        bot: Bot[id],
        user_id: user_id.replace(/^dc_/, ""),
      }
      return {
        sendMsg: msg => this.sendFriendMsg(i, msg),
        recallMsg: () => false,
        makeForwardMsg: msg => this.makeForwardMsg(i, msg),
        getAvatarUrl: () => this.getAvatarUrl(i),
      }
    }
    Bot[id].pickUser = Bot[id].pickFriend

    Bot[id].pickMember = (group_id, user_id) => {
      const i = {
        self_id: id,
        bot: Bot[id],
        group_id: group_id.replace(/^dc_/, ""),
        user_id: user_id.replace(/^dc_/, ""),
      }
      return {
        ...Bot[id].pickFriend(user_id),
      }
    }

    Bot[id].pickGroup = group_id => {
      const i = {
        self_id: id,
        bot: Bot[id],
        id: group_id.replace(/^dc_/, ""),
      }
      return {
        sendMsg: msg => this.sendMsg(i, msg),
        recallMsg: () => false,
        makeForwardMsg: msg => this.makeForwardMsg(i, msg),
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
      this.makeMessage(data)
    })

    logger.mark(`${logger.blue(`[${id}]`)} DiscordBot 已连接`)
    Bot.emit(`connect.${id}`, Bot[id])
    Bot.emit(`connect`, Bot[id])
    return true
  }
}

Bot.once("online", async () => {
  for (const token of config.token)
    await adapter.connect(token)
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
      if (await adapter.connect(token)) {
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