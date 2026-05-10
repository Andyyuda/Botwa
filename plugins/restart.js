const { exec } = require('child_process');
const setting = require('../setting');
const { isOwner } = require('../lib/helper');

module.exports = {
  name: '.restart',
  command: ['.restart'],
  async execute(conn, sender, args, msg) {
    // ✅ FIX LID: ambil JID pengirim dengan benar
    const fromJid = msg.key.participant || msg.key.remoteJid;

    // ✅ FIX: gunakan helper isOwner yang mendukung LID
    if (!isOwner(fromJid, setting.owner)) {
      return conn.sendMessage(sender, {
        text: '⛔ Hanya owner yang bisa menggunakan perintah ini.'
      }, { quoted: msg });
    }

    await conn.sendMessage(sender, {
      text: '♻️ Bot sedang direstart...'
    }, { quoted: msg });

    exec('systemctl restart klmpkbot', (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Gagal restart:', err.message);
        return conn.sendMessage(sender, {
          text: '❌ Gagal restart bot.'
        }, { quoted: msg });
      }

      console.log('✅ Restart command executed.');
    });
  }
};
