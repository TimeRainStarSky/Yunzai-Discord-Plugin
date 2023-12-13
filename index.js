logger.info(logger.yellow("- 正在加载 Discord 适配器插件"))

import { config, configSave } from "./Model/config.js"
import path from "node:path"
import Eris from "eris"
import { HttpsProxyAgent } from "https-proxy-agent"

const adapter = new class DiscordAdapter {
  constructor() {
    this.id = "Discord"
    this.name = "DiscordBot"
    this.version = `eris ${config.package.dependencies.eris.replace("^", "v")}`
  }

  async makeMsg(msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    let msg_log = ""
    const content = { content: "" }, files = []

    for (let i of msg) {
      if (typeof i != "object")
        i = { type: "text", text: i }

      let file
      if (i.file) {
        file = await Bot.fileType(i.file, i.name)
        files.push({ name: file.name, file: file.buffer })
      }

      switch (i.type) {
        case "text":
          msg_log += i.text
          content.content += i.text
          break
        case "image":
          msg_log += `[图片：${file.name}(${file.url} ${(file.buffer.length/1024).toFixed(2)}KB)]`
          break
        case "record":
          msg_log += `[音频：${file.name}(${file.url} ${(file.buffer.length/1024).toFixed(2)}KB)]`
          break
        case "video":
          msg_log += `[视频：${file.name}(${file.url} ${(file.buffer.length/1024).toFixed(2)}KB)]`
          break
        case "reply":
          msg_log += `[回复：${i.id}]`
          content.messageReference = { messageID: i.id }
          break
        case "at":
          msg_log += `[提及：${i.qq}]`
          if (i.qq == "all")
            content.content += "@everyone"
          else
            content.content += `<@${i.qq.replace(/^dc_/, "")}>`
          break
        case "node":
          for (const { message } of i.data) {
            const ret = await this.makeMsg(message)
            if (ret.msg_log)
              msg_log += `\n${ret.msg_log}`
            if (ret.content.content)
              content.content += `\n${ret.content.content}`
            if (ret.content.messageReference)
              content.messageReference = ret.content.messageReference
            if (ret.files.length)
              files.push(...ret.files)
          }
          break
        default:
          i = JSON.stringify(i)
          msg_log += i
          content.content += i
      }
    }
    return { content, msg_log, files }
  }

  async sendMsg(data, msg) {
    const { content, msg_log, files } = await this.makeMsg(msg)
    Bot.makeLog("info", `发送消息：[${data.id}] ${msg_log}`, data.self_id)
    const ret = await data.bot.createMessage(data.id, content, files)
    return { data: ret, message_id: ret.id }
  }

  async sendFriendMsg(data, msg) {
    data.id = (await this.getFriendInfo(data)).id
    return this.sendMsg(data, msg)
  }

  async getMsg(data, message_id) {
    return this.makeMessageArray(await data.bot.getMessage(data.id, message_id))
  }

  async getFriendMsg(data, message_id) {
    data.id = (await this.getFriendInfo(data)).id
    return this.getMsg(data, message_id)
  }

  recallMsg(data, message_id) {
    Bot.makeLog("info", `撤回消息：[${data.id}] ${message_id}`, data.self_id)
    return data.bot.deleteMessage(data.id, message_id)
  }

  async recallFriendMsg(data, message_id) {
    data.id = (await this.getFriendInfo(data)).id
    return this.recallMsg(data, message_id)
  }

  async getFriendInfo(data) {
    const i = await data.bot.getDMChannel(data.user_id)
    return {
      ...i,
      user_id: i.recipient.id,
      nickname: i.recipient.username,
      avatar: i.recipient.avatarURL,
    }
  }

  getFriendArray(id) {
    const array = []
    for (const [user_id, i] of Bot[id].users)
      array.push({
        user: i,
        user_id: `dc_${user_id}`,
        nickname: i.username,
        avatar: i.avatarURL,
      })
    return array
  }

  getFriendList(id) {
    const array = []
    for (const { user_id } of this.getFriendArray(id))
      array.push(user_id)
    return array
  }

  getFriendMap(id) {
    const map = new Map
    for (const i of this.getFriendArray(id))
      map.set(i.user_id, i)
    return map
  }

  getGroupArray(id) {
    const array = []
    for (const [guild_id, guild] of Bot[id].guilds)
      for (const [channel_id, channel] of guild.channels)
        array.push({
          guild,
          channel,
          group_id: `dc_${channel.id}`,
          group_name: `${guild.name}-${channel.name}`,
        })
    return array
  }

  getGroupList(id) {
    const array = []
    for (const { group_id } of this.getGroupArray(id))
      array.push(group_id)
    return array
  }

  getGroupMap(id) {
    const map = new Map
    for (const i of this.getGroupArray(id))
      map.set(i.group_id, i)
    return map
  }

  getGroupMemberMap(id) {
    const map = new Map
    for (const i of this.getGroupList(id))
      map.set(i, new Map)
    return map
  }

  pickFriend(id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(/^dc_/, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      getMsg: message_id => this.getFriendMsg(i, message_id),
      recallMsg: message_id => this.recallFriendMsg(i, message_id),
      getInfo: () => this.getFriendInfo(i),
      getAvatarUrl: async () => (await this.getFriendInfo(i)).avatar,
    }
  }

  pickMember(id, group_id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(/^dc_/, ""),
      user_id: user_id.replace(/^dc_/, ""),
    }
    return {
      ...this.pickFriend(id, user_id),
      ...i,
    }
  }

  pickGroup(id, group_id) {
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      id: group_id.replace(/^dc_/, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendMsg(i, msg),
      getMsg: message_id => this.getMsg(i, message_id),
      recallMsg: message_id => this.recallMsg(i, message_id),
      getAvatarUrl: () => i.guild.iconURL,
      pickMember: user_id => this.pickMember(id, i.id, user_id),
    }
  }

  makeMessageArray(data) {
    data.user_id = `dc_${data.author.id}`
    data.sender = {
      user_id: data.user_id,
      nickname: data.author.username,
      avatar: data.author.avatarURL,
    }
    data.message_id = data.id

    data.message = []
    data.raw_message = ""

    if (data.messageReference?.messageID) {
      data.message.push({ type: "reply", id: data.messageReference.messageID })
      data.raw_message += `[回复：${data.messageReference.messageID}]`
    }

    if (data.content) {
      const match = data.content.match(/<@.+?>/g)
      if (match) {
        let content = data.content
        for (const i of match) {
          const msg = content.split(i)
          const prev_msg = msg.shift()
          if (prev_msg) {
            data.message.push({ type: "text", text: prev_msg })
            data.raw_message += prev_msg
          }
          content = msg.join(i)

          const qq = `dc_${i.replace(/<@(.+?)>/, "$1")}`
          data.message.push({ type: "at", qq })
          data.raw_message += `[提及：${qq}]`
        }
        if (content) {
          data.message.push({ type: "text", text: content })
          data.raw_message += content
        }
      } else {
        data.message.push({ type: "text", text: data.content })
        data.raw_message += data.content
      }
    }

    for (const i of data.attachments) {
      i.type = i.content_type.split("/")[0]
      i.file = i.filename
      data.message.push(i)
      data.raw_message += JSON.stringify(i)
    }

    return data
  }

  makeMessage(data) {
    data.post_type = "message"
    data = this.makeMessageArray(data)
    if (data.user_id == data.self_id) return

    if (data.guildID) {
      data.message_type = "group"
      data.group_id = `dc_${data.channel.id}`
      data.group_name = `${data.channel.guild.name}-${data.channel.name}`
      Bot.makeLog("info", `群消息：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    } else {
      data.message_type = "private"
      Bot.makeLog("info", `好友消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    }

    delete data.member
    Bot.em(`${data.post_type}.${data.message_type}`, data)
  }

  async connect(token) {
    const options = {
      intents: ["all"],
      ws: {},
      rest: {},
    }

    if (config.proxy) {
      options.ws.agent = new HttpsProxyAgent(config.proxy)
      options.rest.agent = options.ws.agent
    }

    if (config.reverseProxy)
      options.rest.domain = config.reverseProxy

    const bot = new Eris(`Bot ${token}`, options)
    bot.on("error", logger.error)
    bot.login = bot.connect
    bot.logout = bot.disconnect
    await new Promise(resolve => {
      bot.once("ready", resolve)
      bot.login()
    })

    if (!bot.user?.id) {
      logger.error(`${logger.blue(`[${token}]`)} ${this.name}(${this.id}) ${this.version} 连接失败`)
      bot.disconnect()
      return false
    }

    const id = `dc_${bot.user.id}`
    Bot[id] = bot
    Bot[id].adapter = this
    Bot[id].info = Bot[id].user
    Bot[id].uin = id
    Bot[id].nickname = Bot[id].info.username
    Bot[id].avatar = Bot[id].info.avatarURL
    Bot[id].version = {
      id: this.id,
      name: this.name,
      version: this.version,
    }
    Bot[id].stat = { start_time: Bot[id].startTime/1000 }

    Bot[id].pickFriend = user_id => this.pickFriend(id, user_id)
    Bot[id].pickUser = Bot[id].pickFriend

    Bot[id].getFriendArray = () => this.getFriendArray(id)
    Bot[id].getFriendList = () => this.getFriendList(id)
    Bot[id].getFriendMap = () => this.getFriendMap(id)

    Bot[id].pickMember = (group_id, user_id) => this.pickMember(id, group_id, user_id)
    Bot[id].pickGroup = group_id => this.pickGroup(id, group_id)

    Bot[id].getGroupArray = () => this.getGroupArray(id)
    Bot[id].getGroupList = () => this.getGroupList(id)
    Bot[id].getGroupMap = () => this.getGroupMap(id)
    Bot[id].getGroupMemberMap = () => this.getGroupMemberMap(id)

    Object.defineProperty(Bot[id], "fl", { get() { return this.getFriendMap() }})
    Object.defineProperty(Bot[id], "gl", { get() { return this.getGroupMap() }})
    Object.defineProperty(Bot[id], "gml", { get() { return this.getGroupMemberMap() }})

    bot.on("messageCreate", data => {
      data.self_id = id
      this.makeMessage(data)
    })

    logger.mark(`${logger.blue(`[${id}]`)} ${this.name}(${this.id}) ${this.version} 已连接`)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async load() {
    for (const token of config.token)
      await new Promise(resolve => {
        adapter.connect(token).then(resolve)
        setTimeout(resolve, 5000)
      })
  }
}

Bot.adapter.push(adapter)

export class Discord extends plugin {
  constructor() {
    super({
      name: "DiscordAdapter",
      dsc: "Discord 适配器设置",
      event: "message",
      rule: [
        {
          reg: "^#[Dd][Cc]账号$",
          fnc: "List",
          permission: config.permission,
        },
        {
          reg: "^#[Dd][Cc]设置.+$",
          fnc: "Token",
          permission: config.permission,
        },
        {
          reg: "^#[Dd][Cc](代理|反代)",
          fnc: "Proxy",
          permission: config.permission,
        }
      ]
    })
  }

  List() {
    this.reply(`共${config.token.length}个账号：\n${config.token.join("\n")}`, true)
  }

  async Token() {
    const token = this.e.msg.replace(/^#[Dd][Cc]设置/, "").trim()
    if (config.token.includes(token)) {
      config.token = config.token.filter(item => item != token)
      this.reply(`账号已删除，重启后生效，共${config.token.length}个账号`, true)
    } else {
      if (await adapter.connect(token)) {
        config.token.push(token)
        this.reply(`账号已连接，共${config.token.length}个账号`, true)
      } else {
        this.reply(`账号连接失败`, true)
        return false
      }
    }
    configSave(config)
  }

  Proxy() {
    const proxy = this.e.msg.replace(/^#[Dd][Cc](代理|反代)/, "").trim()
    if (this.e.msg.match("代理")) {
      config.proxy = proxy
      this.reply(`代理已${proxy?"设置":"删除"}，重启后生效`, true)
    } else {
      config.reverseProxy = proxy
      this.reply(`反代已${proxy?"设置":"删除"}，重启后生效`, true)
    }
    configSave(config)
  }
}

logger.info(logger.green("- Discord 适配器插件 加载完成"))