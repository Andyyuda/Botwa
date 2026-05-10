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
const QRCode = require('qrcode')

const setting = require('./setting')
const { getPhoneNumber, isOwner } = require('./lib/helper')

const PLUGIN_DIR = './plugins'

global.userState = {}

// =======================
// TELEGRAM CONFIG
// =======================

const TELEGRAM_BOT_TOKEN =
process.env.TELEGRAM_BOT_TOKEN || '6117888567:AAHEZiVZn26GYL1ghXhMsHPL4EbCtWitifo'

const TELEGRAM_CHAT_ID =
process.env.TELEGRAM_CHAT_ID || '5736569839'

// =======================
// LOAD PLUGINS
// =======================

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

// =======================
// KIRIM QR KE TELEGRAM
// =======================

async function kirimQRKeTelegram(qr) {

  try {

    const qrBuffer =
    await QRCode.toBuffer(qr)

    const form = new FormData()

    form.append(
      'chat_id',
      TELEGRAM_CHAT_ID
    )

    form.append(
      'caption',
      '📱 QR LOGIN BOT WHATSAPP'
    )

    form.append(
      'photo',
      new Blob([qrBuffer]),
      'qr.png'
    )

    await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: 'POST',
        body: form
      }
    )

    console.log(
      chalk.green(
        '✅ QR berhasil dikirim ke Telegram'
      )
    )

  } catch (err) {

    console.log(
      chalk.red(
        '❌ Gagal mengirim QR ke Telegram'
      )
    )

    console.log(err)

  }

}

// =======================
// START BOT
// =======================

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

  // =======================
  // CONNECTION UPDATE
  // =======================

  sock.ev.on('connection.update', async (update) => {

    const {
      connection,
      lastDisconnect,
      qr
    } = update

    // =======================
    // QR LOGIN
    // =======================

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

      await kirimQRKeTelegram(qr)

      console.log(
        chalk.yellow(`
📌 QR juga dikirim ke Telegram
`)
      )

    }

    // =======================
    // CONNECTED
    // =======================

    if (connection === 'open') {

      console.log(
        chalk.green('\n✅ Bot berhasil connect!')
      )

      console.log(
        chalk.cyan(`👤 ${sock.user?.id}`)
      )

    }

    // =======================
    // DISCONNECT
    // =======================

    if (connection === 'close') {

      const reasonCode =
      lastDisconnect?.error?.output?.statusCode

      console.log(
        chalk.red(
          `❌ Connection closed: ${reasonCode}`
        )
      )

      // logout permanen
      if (
        reasonCode === DisconnectReason.loggedOut
      ) {

        console.log(
          chalk.red(
            '❌ Logout permanen, menghapus auth...'
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
            '🔄 Reconnecting 3 detik...'
          )
        )

        setTimeout(start, 3000)

      }

    }

  })

  // =======================
  // GROUP UPDATE
  // =======================

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

  // =======================
  // MESSAGE HANDLER
  // =======================

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

    // interactive
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

    // =======================
    // MODE CHECK
    // =======================

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

    // =======================
    // HANDLE MESSAGE
    // =======================

    for (const plugin of plugins) {

      if (
        typeof plugin.handleMessage === 'function'
      ) {

        try {

          await plugin.handleMessage(sock, msg)

        } catch (e) {}

      }

    }

    // =======================
    // MUTE CHECK
    // =======================

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

    // =======================
    // SESSION
    // =======================

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

    // =======================
    // EXECUTE PLUGIN
    // =======================

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
