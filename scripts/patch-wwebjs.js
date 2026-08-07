/**
 * Temporary patch for whatsapp-web.js 1.34.7:
 * WhatsApp Web renamed message key `_serialized` -> `$1`, which breaks
 * getChats()/getChatById() with a cryptic "r" error.
 * Remove once upstream merges a fix.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js');
const utilsPath = path.join(root, 'src', 'util', 'Injected', 'Utils.js');
const puppeteerPath = path.join(root, 'src', 'util', 'Puppeteer.js');

if (!fs.existsSync(utilsPath)) {
  console.error('whatsapp-web.js not found at', utilsPath);
  process.exit(1);
}

let s = fs.readFileSync(utilsPath, 'utf8');

if (s.includes('window.WWebJS.getMsgKeyId')) {
  console.log('Utils.js already patched');
} else {
  const replacements = [
    [
      `        return window
            .require('WAWebCollections')
            .Msg.get(newMsgKey._serialized);`,
      `        return window
            .require('WAWebCollections')
            .Msg.get(window.WWebJS.getMsgKeyId(newMsgKey));`,
    ],
    [
      `        return window.require('WAWebCollections').Msg.get(msg.id._serialized);`,
      `        return window
            .require('WAWebCollections')
            .Msg.get(window.WWebJS.getMsgKeyId(msg.id));`,
    ],
    [
      `        if (typeof msg.id.remote === 'object') {
            msg.id = Object.assign({}, msg.id, {
                remote: msg.id.remote._serialized,
            });
        }

        delete msg.pendingAckUpdate;`,
      `        if (typeof msg.id.remote === 'object') {
            msg.id = Object.assign({}, msg.id, {
                remote: msg.id.remote._serialized,
            });
        }

        // Tolerate WA Web renaming message key _serialized -> $1
        if (typeof msg.id === 'object' && msg.id._serialized == null) {
            const serializedId = window.WWebJS.getMsgKeyId(msg.id);
            if (serializedId) {
                msg.id = Object.assign({}, msg.id, {
                    _serialized: serializedId,
                });
            }
        }

        delete msg.pendingAckUpdate;`,
    ],
    [
      `    window.WWebJS.getChats = async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        const chatPromises = chats.map((chat) =>
            window.WWebJS.getChatModel(chat),
        );
        return await Promise.all(chatPromises);
    };`,
      `    window.WWebJS.getMsgKeyId = (key) =>
        key?._serialized ?? key?.$1 ?? undefined;

    window.WWebJS.getChats = async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        const results = [];
        for (const chat of chats) {
            try {
                const model = await window.WWebJS.getChatModel(chat);
                if (model) results.push(model);
            } catch {
                // skip chats that fail serialization
            }
        }
        return results;
    };`,
    ],
    [
      `            const groupMetadata =
                window.require('WAWebCollections').GroupMetadata ||
                window.require('WAWebCollections').WAWebGroupMetadataCollection;
            await groupMetadata.update(chatWid);
            const { toPn } = window.require('WAWebLidMigrationUtils');`,
      `            const groupMetadata =
                window.require('WAWebCollections').GroupMetadata ||
                window.require('WAWebCollections').WAWebGroupMetadataCollection;
            try {
                await groupMetadata.update(chatWid);
            } catch {
                model.groupMetadata = null;
            }
            const { toPn } = window.require('WAWebLidMigrationUtils');`,
    ],
    [
      `        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const lastMessage = chat.lastReceivedKey
                ? window
                      .require('WAWebCollections')
                      .Msg.get(chat.lastReceivedKey._serialized) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([
                              chat.lastReceivedKey._serialized,
                          ])
                  )?.messages?.[0]
                : null;`,
      `        model.lastMessage = null;
        if (model.msgs && model.msgs.length) {
            const lastReceivedKeyId = window.WWebJS.getMsgKeyId(
                chat.lastReceivedKey,
            );
            const lastMessage = lastReceivedKeyId
                ? window
                      .require('WAWebCollections')
                      .Msg.get(lastReceivedKeyId) ||
                  (
                      await window
                          .require('WAWebCollections')
                          .Msg.getMessagesById([lastReceivedKeyId])
                  )?.messages?.[0]
                : null;`,
    ],
  ];

  let ok = 0;
  for (const [from, to] of replacements) {
    if (!s.includes(from)) {
      console.error('MISS:', from.slice(0, 100).replace(/\n/g, '\\n'));
      process.exit(1);
    }
    s = s.replace(from, to);
    ok++;
  }
  fs.writeFileSync(utilsPath, s);
  console.log(`Utils.js patched (${ok}/${replacements.length})`);
}

let ps = fs.readFileSync(puppeteerPath, 'utf8');
if (ps.includes('/already exists/')) {
  console.log('Puppeteer.js already patched');
} else {
  const oldP = `    if (exist) {
        return;
    }
    await page.exposeFunction(name, fn);
}`;
  const newP = `    if (exist) {
        return;
    }
    try {
        await page.exposeFunction(name, fn);
    } catch (err) {
        if (!/already exists/.test(err.message)) {
            throw err;
        }
    }
}`;
  if (!ps.includes(oldP)) {
    console.error('Puppeteer.js: pattern not found');
    process.exit(1);
  }
  fs.writeFileSync(puppeteerPath, ps.replace(oldP, newP));
  console.log('Puppeteer.js patched');
}

console.log('Done.');
