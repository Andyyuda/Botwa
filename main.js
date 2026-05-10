const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys')

const fs = require('fs')
const path = require('path')
const pino = require('pino')
const chalk = require('chalk')
const qrcode = require('qrcode-terminal')

const setting = require('./setting')
const { getPhoneNumber, isOwner } = require('./lib/helper')

const PLUGIN_DIR = './plugins'

global.userState = {}

// 🔌 Load semua plugin
let plugins = []

fs.readdirSync(PLUGIN_DIR).forEach(file => {

  if (file.endsWith('.js')) {

    const plugin =
    require(path.join(__dirname, PLUGIN_DIR, file))

    plugins.push(plugin)

    console.log(
      chalk.green(`✅ Plugin loaded: ${plugin.name}`)
    )

  }

})

global.plugins = plugins

async function start() {

  const { state, saveCreds } =
  await useMultiFileAuthState('./auth')

  const { version } =
  await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['BotWa', 'Desktop', '1.0']
  })

  sock.ev.on('creds.update', saveCreds)

  // 🔗 Connection Update
  sock.ev.on('connection.update', async (update) => {

    const {
      connection,
      lastDisconnect,
      qr
    } = update

    // 📱 Tampilkan QR
    if (qr) {

      console.clear()

      console.log(
        chalk.cyan(`
╔══════════════════════════════╗
║        SCAN QR LOGIN         ║
╚══════════════════════════════╝
`)
      )

      qrcode.generate(qr, {
        small: true
      })

      console.log(
        chalk.yellow(`
📌 Cara Login:
1. Buka WhatsApp
2. Linked Devices
3. Link a Device
4. Scan QR di atas
`)
      )

    }

    // ✅ Connected
    if (connection === 'open') {

      console.log(
        chalk.green('\n✅ Terhubung ke WhatsApp!')
      )

      console.log(
        chalk.cyan(`👤 Bot: ${sock.user?.id}`)
      )

    }

    // ❌ Disconnect
    if (connection === 'close') {

      const reasonCode =
      lastDisconnect?.error?.output?.statusCode

      console.log(
        chalk.red(`❌ Connection closed: ${reasonCode}`)
      )

      // logout permanen
      if (reasonCode === DisconnectReason.loggedOut) {

        console.log(
          chalk.red(
            '❌ Logout permanen. Menghapus session...'
          )
        )

        fs.rmSync('./auth', {
          recursive: true,
          force: true
        })

        setTimeout(start, 3000)

      } else {

        console.log(
          chalk.yellow(
            '🔄 Reconnecting dalam 3 detik...'
          )
        )

        setTimeout(start, 3000)

      }

    }

  })

  // 🧑‍🤝‍🧑 Join/Leave Group
  sock.ev.on(
    'group-participants.update',
    async (update) => {

      for (const plugin of plugins) {

        if (
          typeof plugin.handleParticipantUpdate ===
          'function'
        ) {

          try {

            await plugin.handleParticipantUpdate(
              sock,
              update
            )

          } catch (err) {

            console.error(
              '❌ Plugin group error:',
              err
            )

          }

        }

      }

    }
  )

  // 📩 Pesan Masuk
  sock.ev.on('messages.upsert', async ({ messages }) => {

    const msg = messages[0]

    if (
      !msg?.message ||
      msg.key.remoteJid === 'status@broadcast'
    ) return

    const remoteJid = msg.key.remoteJid
    const sender = remoteJid

    const senderJid =
    msg.key.participant || remoteJid

    const senderNumber =
    getPhoneNumber(senderJid)

    const isGroupMsg =
    remoteJid.endsWith('@g.us')

    const isPrivate = !isGroupMsg

    const ownerCheck =
    isOwner(senderJid, setting.owner)

    let text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      msg.message?.documentMessage?.caption ||
      msg.message?.buttonsResponseMessage?.selectedButtonId ||
      msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
      ''

    // interactive response
    if (
      msg.message?.interactiveResponseMessage
        ?.nativeFlowResponseMessage?.paramsJson
    ) {

      try {

        const params = JSON.parse(
          msg.message.interactiveResponseMessage
          .nativeFlowResponseMessage.paramsJson
        )

        text = params.id

      } catch (e) {}

    }

    if (!text) return

    console.log(
      chalk.blue(
        `[IN] ${senderJid} -> ${remoteJid}: ${text}`
      )
    )

    // ⛔ Mode akses
    let mode = 'off'

    for (const name of [
      '.onlyprivate',
      '.onlygc',
      '.onlyowner'
    ]) {

      const p = plugins.find(
        x => x.name === name
      )

      if (
        p &&
        typeof p.getMode === 'function'
      ) {

        const result = p.getMode()

        if (result !== 'off') {
          mode = result
          break
        }

      }

    }

    if (
      (mode === 'private' && !isPrivate) ||
      (mode === 'group' && !isGroupMsg) ||
      (mode === 'owner' && !ownerCheck)
    ) return

    // 🔇 Handle mute plugin
    for (const plugin of plugins) {

      if (
        typeof plugin.handleMessage === 'function'
      ) {

        try {

          await plugin.handleMessage(sock, msg)

        } catch (e) {}

      }

    }

    // 🔒 Hapus pesan mute
    if (isGroupMsg && msg.key.participant) {

      try {

        const muteDB = JSON.parse(
          fs.readFileSync('./mute.json')
        )

        if (
          muteDB[remoteJid]?.[senderJid] === true
        ) {

          await sock.sendMessage(
            remoteJid,
            { delete: msg.key }
          )

          return

        }

      } catch (e) {}

    }

    // 🔄 Session user
    const session =
    global.userState[sender]

    if (session) {

      const plugin = plugins.find(
        p => p.name === session.status
      )

      if (
        plugin &&
        typeof plugin.handleSession ===
        'function'
      ) {

        return await plugin.handleSession(
          sock,
          sender,
          text,
          msg
        )

      }

    }

    // ⚙️ Execute plugin
    const [command, ...args] =
    text.trim().split(' ')

    const plugin = plugins.find(
      p =>
        p.name === command.toLowerCase() ||
        (
          Array.isArray(p.command) &&
          p.command.includes(
            command.toLowerCase()
          )
        )
    )

    if (
      plugin &&
      typeof plugin.execute === 'function'
    ) {

      try {

        await plugin.execute(
          sock,
          sender,
          args,
          msg,
          text
        )

      } catch (err) {

        console.error(
          '❌ Plugin error:',
          err
        )

        await sock.sendMessage(
          sender,
          {
            text:
            '⚠️ Terjadi error saat menjalankan perintah.'
          },
          {
            quoted: msg
          }
        )

      }

    }

  })

}

start()
