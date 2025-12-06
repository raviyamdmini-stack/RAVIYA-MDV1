const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys');

// ---------------- CONFIG ----------------

const BOT_NAME_FANCY = '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'false',
  AUTO_LIKE_EMOJI: ['🔥','😀','👍','😃','😄','😁','😎','🥳','🌞','🌈','❤️'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/L6AbGyOmgqU4kse6IwPL3S?mode=wwt',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/m9wpbi.jpg',
  NEWSLETTER_JID: '120363402716908892@newsletter',
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER || '94785316830',
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbB8UoBHrDZd364h8b34',
  BOT_NAME: '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥',
  BOT_VERSION: '1.0.0V',
  OWNER_NAME: 'Yasas Dileepa',
  IMAGE_PATH: 'https://files.catbox.moe/m9wpbi.jpg',
  BOT_FOOTER: '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥',
  BUTTON_IMAGES: { ALIVE: 'https://files.catbox.moe/m9wpbi.jpg' }
};

// ---------------- MONGO SETUP ----------------

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://botmini:botmini@minibot.upglk0f.mongodb.net/?retryWrites=true&w=majority';
const MONGO_DB = process.env.MONGO_DB || 'DTECDD_MINI';

let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected && mongoClient.topology.isConnected()) return;
  } catch(e){}
  mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await mongoClient.connect();
  mongoDB = mongoClient.db(MONGO_DB);

  sessionsCol = mongoDB.collection('sessions');
  numbersCol = mongoDB.collection('numbers');
  adminsCol = mongoDB.collection('admins');
  newsletterCol = mongoDB.collection('newsletter_list');
  configsCol = mongoDB.collection('configs');
  newsletterReactsCol = mongoDB.collection('newsletter_reacts');

  await sessionsCol.createIndex({ number: 1 }, { unique: true });
  await numbersCol.createIndex({ number: 1 }, { unique: true });
  await newsletterCol.createIndex({ jid: 1 }, { unique: true });
  await newsletterReactsCol.createIndex({ jid: 1 }, { unique: true });
  await configsCol.createIndex({ number: 1 }, { unique: true });
  console.log('✅ Mongo initialized and collections ready');
}

// ---------------- Mongo helpers ----------------

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
    console.log(`Saved creds to Mongo for ${sanitized}`);
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
    console.log(`Removed session from Mongo for ${sanitized}`);
  } catch (e) { console.error('removeSessionToMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
    console.log(`Added number ${sanitized} to Mongo numbers`);
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
    console.log(`Removed number ${sanitized} from Mongo numbers`);
  } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    await initMongo();
    const doc = { jid: jidOrNumber };
    await adminsCol.updateOne({ jid: jidOrNumber }, { $set: doc }, { upsert: true });
    console.log(`Added admin ${jidOrNumber}`);
  } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    await initMongo();
    await adminsCol.deleteOne({ jid: jidOrNumber });
    console.log(`Removed admin ${jidOrNumber}`);
  } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function addNewsletterToMongo(jid, emojis = []) {
  try {
    await initMongo();
    const doc = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date() };
    await newsletterCol.updateOne({ jid }, { $set: doc }, { upsert: true });
    console.log(`Added newsletter ${jid} -> emojis: ${doc.emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
  try {
    await initMongo();
    await newsletterCol.deleteOne({ jid });
    console.log(`Removed newsletter ${jid}`);
  } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    await initMongo();
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    if (!mongoDB) await initMongo();
    const col = mongoDB.collection('newsletter_reactions_log');
    await col.insertOne(doc);
    console.log(`Saved reaction ${emoji} for ${jid}#${messageId}`);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await configsCol.findOne({ number: sanitized });
    return doc ? doc.config : null;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return null; }
}

// -------------- newsletter react-config helpers --------------

async function addNewsletterReactConfig(jid, emojis = []) {
  try {
    await initMongo();
    await newsletterReactsCol.updateOne({ jid }, { $set: { jid, emojis, addedAt: new Date() } }, { upsert: true });
    console.log(`Added react-config for ${jid} -> ${emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterReactConfig', e); throw e; }
}

async function removeNewsletterReactConfig(jid) {
  try {
    await initMongo();
    await newsletterReactsCol.deleteOne({ jid });
    console.log(`Removed react-config for ${jid}`);
  } catch (e) { console.error('removeNewsletterReactConfig', e); throw e; }
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function getReactConfigForJid(jid) {
  try {
    await initMongo();
    const doc = await newsletterReactsCol.findOne({ jid });
    return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
  } catch (e) { console.error('getReactConfigForJid', e); return null; }
}

// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp(){ return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();

const socketCreationTime = new Map();

const otpStore = new Map();

// ---------------- helpers kept/adapted ----------------

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`🔐 OTP VERIFICATION — ${BOT_NAME_FANCY}`, `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.\n\nNumber: ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- handlers (newsletter + reactions) ----------------

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      const followedDocs = await listNewslettersFromMongo(); // array of {jid, emojis}
      const reactConfigs = await listNewsletterReactsFromMongo(); // [{jid, emojis}]
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      const followedJids = followedDocs.map(d => d.jid);
      if (!followedJids.includes(jid) && !reactMap.has(jid)) return;

      let emojis = reactMap.get(jid) || null;
      if ((!emojis || emojis.length === 0) && followedDocs.find(d => d.jid === jid)) {
        emojis = (followedDocs.find(d => d.jid === jid).emojis || []);
      }
      if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          console.log(`Reacted to ${jid} ${messageId} with ${emoji}`);
          await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
          break;
        } catch (err) {
          console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await delay(1200);
        }
      }

    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}


// ---------------- status + revocation + resizing ----------------

async function setupStatusHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
    
    try {
      // Load user-specific config from MongoDB
      let userEmojis = config.AUTO_LIKE_EMOJI; // Default emojis
      let autoViewStatus = config.AUTO_VIEW_STATUS; // Default from global config
      let autoLikeStatus = config.AUTO_LIKE_STATUS; // Default from global config
      let autoRecording = config.AUTO_RECORDING; // Default from global config
      
      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
        
        // Check for emojis in user config
        if (userConfig.AUTO_LIKE_EMOJI && Array.isArray(userConfig.AUTO_LIKE_EMOJI) && userConfig.AUTO_LIKE_EMOJI.length > 0) {
          userEmojis = userConfig.AUTO_LIKE_EMOJI;
        }
        
        // Check for auto view status in user config
        if (userConfig.AUTO_VIEW_STATUS !== undefined) {
          autoViewStatus = userConfig.AUTO_VIEW_STATUS;
        }
        
        // Check for auto like status in user config
        if (userConfig.AUTO_LIKE_STATUS !== undefined) {
          autoLikeStatus = userConfig.AUTO_LIKE_STATUS;
        }
        
        // Check for auto recording in user config
        if (userConfig.AUTO_RECORDING !== undefined) {
          autoRecording = userConfig.AUTO_RECORDING;
        }
      }

      // Use auto recording setting (from user config or global)
      if (autoRecording === 'true') {
        await socket.sendPresenceUpdate("recording", message.key.remoteJid);
      }
      
      // Use auto view status setting (from user config or global)
      if (autoViewStatus === 'true') {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try { 
            await socket.readMessages([message.key]); 
            break; 
          } catch (error) { 
            retries--; 
            await delay(1000 * (config.MAX_RETRIES - retries)); 
            if (retries===0) throw error; 
          }
        }
      }
      
      // Use auto like status setting (from user config or global)
      if (autoLikeStatus === 'true') {
        const randomEmoji = userEmojis[Math.floor(Math.random() * userEmojis.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(message.key.remoteJid, { 
              react: { text: randomEmoji, key: message.key } 
            }, { statusJidList: [message.key.participant] });
            break;
          } catch (error) { 
            retries--; 
            await delay(1000 * (config.MAX_RETRIES - retries)); 
            if (retries===0) throw error; 
          }
        }
      }

    } catch (error) { 
      console.error('Status handler error:', error); 
    }
  });
}


async function handleMessageRevocation(socket, number) {
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys || keys.length === 0) return;
    const messageKey = keys[0];
    const userJid = jidNormalizedUser(socket.user.id);
    const deletionTime = getSriLankaTimestamp();
    const message = formatMessage('🗑️ MESSAGE DELETED', `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
    catch (error) { console.error('Failed to send deletion notification:', error); }
  });
}


async function resize(image, width, height) {
  let oyy = await Jimp.read(image);
  return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}


// ---------------- command handlers ----------------

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const type = getContentType(msg.message);
    if (!msg.message) return;
    msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

    const from = msg.key.remoteJid;
    const sender = from;
    const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
    const senderNumber = (nowsender || '').split('@')[0];
    const developers = `${config.OWNER_NUMBER}`;
    const botNumber = socket.user.id.split(':')[0];
    const isbot = botNumber.includes(senderNumber);
    const isOwner = isbot ? isbot : developers.includes(senderNumber);
    const isGroup = from.endsWith("@g.us");

    // ----------- ✅ CUSTOM REACT LOGIC (Updated for 2 numbers) -----------
    if (senderNumber.includes('94785316830') || senderNumber.includes('94786536712')) {
        const isReact = !!msg.message.reactionMessage; 
        if (!isReact) {
            try {
                await socket.sendMessage(msg.key.remoteJid, { react: { text: '🍁', key: msg.key } });
            } catch (error) {
               // error handling
            }
        }
    }
    // ---------------------------------------------------------------------

    const body = (type === 'conversation') ? msg.message.conversation
      : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text
      : (type === 'imageMessage' && msg.message.imageMessage.caption) ? msg.message.imageMessage.caption
      : (type === 'videoMessage' && msg.message.videoMessage.caption) ? msg.message.videoMessage.caption
      : (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
      : (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
      : (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') : '';

    if (!body || typeof body !== 'string') return;

    const prefix = config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
    const args = body.trim().split(/ +/).slice(1);

    // helper: download quoted media into buffer
    async function downloadQuotedMedia(quoted) {
      if (!quoted) return null;
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) return null;
      const messageType = qType.replace(/Message$/i, '').toLowerCase();
      const stream = await downloadContentFromMessage(quoted[qType], messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return {
        buffer,
        mime: quoted[qType].mimetype || '',
        caption: quoted[qType].caption || quoted[qType].fileName || '',
        ptt: quoted[qType].ptt || false,
        fileName: quoted[qType].fileName || ''
      };
    }

    // ---------------------------------------------------------------------
    // ✅ ADVANCED SETTINGS REPLY LISTENER (NUMBER REPLY SYSTEM)
    // ---------------------------------------------------------------------
    
    // Check if the quoted message is the Settings Dashboard
    const quotedCaption = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.caption || 
                          msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || "";
    const isReplyToSettings = quotedCaption.includes('BOT SETTINGS DASHBOARD');
    
    if (isReplyToSettings && !isCmd) {
        const selectedOption = body.trim();
        const sanitized = senderNumber.replace(/[^0-9]/g, '');
        let userConfig = await loadUserConfigFromMongo(sanitized) || {};
        let updated = false;

        switch (selectedOption) {
            case '1': // Work Type
                userConfig.WORK_TYPE = (userConfig.WORK_TYPE === 'public') ? 'private' : 'public';
                await socket.sendMessage(sender, { text: `✅ Work Type changed to: *${userConfig.WORK_TYPE.toUpperCase()}*` }, { quoted: msg });
                updated = true;
                break;
            case '2': // Auto Read
                userConfig.AUTO_VIEW_STATUS = (userConfig.AUTO_VIEW_STATUS === 'true') ? 'false' : 'true';
                await socket.sendMessage(sender, { text: `✅ Auto Read Status: *${userConfig.AUTO_VIEW_STATUS.toUpperCase()}*` }, { quoted: msg });
                updated = true;
                break;
            case '3': // Auto Like
                userConfig.AUTO_LIKE_STATUS = (userConfig.AUTO_LIKE_STATUS === 'true') ? 'false' : 'true';
                await socket.sendMessage(sender, { text: `✅ Auto Like Status: *${userConfig.AUTO_LIKE_STATUS.toUpperCase()}*` }, { quoted: msg });
                updated = true;
                break;
            case '4': // Auto Record
                userConfig.AUTO_RECORDING = (userConfig.AUTO_RECORDING === 'true') ? 'false' : 'true';
                await socket.sendMessage(sender, { text: `✅ Auto Recording: *${userConfig.AUTO_RECORDING.toUpperCase()}*` }, { quoted: msg });
                updated = true;
                break;
            case '5': // Auto Type
                userConfig.AUTO_TYPING = (userConfig.AUTO_TYPING === 'true') ? 'false' : 'true';
                await socket.sendMessage(sender, { text: `✅ Auto Typing: *${userConfig.AUTO_TYPING.toUpperCase()}*` }, { quoted: msg });
                updated = true;
                break;
            case '6': // Anti Call
                userConfig.ANTI_CALL = (userConfig.ANTI_CALL === 'on') ? 'off' : 'on';
                await socket.sendMessage(sender, { text: `✅ Anti Call: *${userConfig.ANTI_CALL.toUpperCase()}*` }, { quoted: msg });
                updated = true;
                break;
            default:
                await socket.sendMessage(sender, { text: `❌ Invalid Option! Please reply with a number from 1 to 6.` }, { quoted: msg });
        }

        if (updated) {
            await setUserConfigInMongo(sanitized, userConfig);
            return;
        }
    }

    if (!command) return;

    try {

      // Load user config for work type restrictions
      const sanitized = (number || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      
// ========== ADD WORK TYPE RESTRICTIONS HERE ==========
if (!isOwner) {
  const workType = userConfig.WORK_TYPE || 'public';
  if (workType === "private") {
    console.log(`Command blocked: WORK_TYPE is private for ${sanitized}`);
    return;
  }
  if (isGroup && workType === "inbox") {
    console.log(`Command blocked: WORK_TYPE is inbox but message is from group for ${sanitized}`);
    return;
  }
  if (!isGroup && workType === "groups") {
    console.log(`Command blocked: WORK_TYPE is groups but message is from private chat for ${sanitized}`);
    return;
  }
}
// ========== END WORK TYPE RESTRICTIONS ==========

      switch (command) {
      case 'kick':
case 'remove': {
    if (!m.isGroup) return reply('Group command!');
    if (!isAdmins) return reply('Admin only!');
    if (!isBotAdmins) return reply('Bot must be admin!');
    let users = m.mentionedJid[0] ? m.mentionedJid[0] : m.quoted ? m.quoted.sender : text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    await socket.groupParticipantsUpdate(from, [users], 'remove').then((res) => reply('Kick Success!')).catch((err) => reply('Error!'));
    break;
}

// 2. ADD (ඇඩ් කිරීම)
case 'add': {
    if (!m.isGroup) return reply('Group command!');
    if (!isAdmins) return reply('Admin only!');
    if (!isBotAdmins) return reply('Bot must be admin!');
    let users = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    await socket.groupParticipantsUpdate(from, [users], 'add').then((res) => reply('Added!')).catch((err) => reply('Error!'));
    break;
}
case 'open': {
    if (!m.isGroup) return reply('Group command!');
    if (!isAdmins) return reply('Admin only!');
    if (!isBotAdmins) return reply('Bot must be admin!');
    await socket.groupSettingUpdate(from, 'not_announcement').then((res) => reply('Group Opened!')).catch((err) => reply('Error!'));
    break;
}

// 6. CLOSE (ගෲප් වැසීම - ඇඩ්මින් පමණයි)
case 'close': {
    if (!m.isGroup) return reply('Group command!');
    if (!isAdmins) return reply('Admin only!');
    if (!isBotAdmins) return reply('Bot must be admin!');
    await socket.groupSettingUpdate(from, 'announcement').then((res) => reply('Group Closed!')).catch((err) => reply('Error!'));
    break;
}

// 7. TAGALL (හැමෝම මෙන්ෂන් කිරීම)
case 'tagall': {
    if (!m.isGroup) return reply('Group command!');
    if (!isAdmins) return reply('Admin only!');
    let teks = `📢 *TAG ALL* \n\n ${args.join(" ") || ''}\n\n`;
    let mems = await socket.groupMetadata(from);
    for (let i of mems.participants) { teks += `@${i.id.split('@')[0]}\n`; }
    await socket.sendMessage(from, { text: teks, mentions: mems.participants.map(a => a.id) }, { quoted: msg });
    break;
}

// 8. HIDETAG (නොපෙනී මෙන්ෂන් කිරීම)
case 'hidetag': {
    if (!m.isGroup) return reply('Group command!');
    if (!isAdmins) return reply('Admin only!');
    let mems = await socket.groupMetadata(from);
    await socket.sendMessage(from, { text: args.join(" ") || 'Hi!', mentions: mems.participants.map(a => a.id) }, { quoted: msg });
    break;
}

// 9. LINK (ගෲප් ලින්ක් එක ගැනීම)
case 'link':
case 'invite': {
    if (!m.isGroup) return reply('Group command!');
    if (!isBotAdmins) return reply('Bot must be admin!');
    const code = await socket.groupInviteCode(from);
    reply(`https://chat.whatsapp.com/${code}`);
    break;
}

// 10. REVOKE (ලින්ක් එක වෙනස් කිරීම)
case 'revoke': {
    if (!m.isGroup) return reply('Group command!');
    if (!isAdmins) return reply('Admin only!');
    if (!isBotAdmins) return reply('Bot must be admin!');
    await socket.groupRevokeInvite(from).then((res) => reply('Link Reset!')).catch((err) => reply('Error!'));
    break;
}
      case 'sad':
  try {
    
    const emojis = [
      "😔", "😟", "😕", "🙁", "☹️", 
      "🥺", "😔", "😰", "😧", "😥", 
      "😩", "😫", "😖", "😣", "😞", 
      "😓", "😢", "😭", "😿", "💔", "😪"
    ];

    
    let keyMsg = await socket.sendMessage(sender, { text: emojis[0] }, { quoted: msg });
    for (let i = 1; i < emojis.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
     
      await socket.sendMessage(sender, { text: emojis[i], edit: keyMsg.key });
    }

   

  } catch (e) {
    console.error('Error in sad command:', e);
  }
  break;
  case 'qr': {
  try {
    if (!args.join(" ")) return await socket.sendMessage(sender, { text: "QR එකට ඕන දේ ලියන්න." }, { quoted: msg });
    const text = args.join(" ");
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
    await socket.sendMessage(sender, { image: { url: url }, caption: `✅ *QR Generated for:* ${text}` }, { quoted: msg });
  } catch (e) { console.error(e); }
  break;
}
case 'rate':
case 'currency': {
  try {
    const { data } = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    const lkr = data.rates.LKR;
    await socket.sendMessage(sender, { text: `💰 *EXCHANGE RATE*\n\n🇺🇸 1 USD = 🇱🇰 ${lkr} LKR\n📅 Date: ${data.date}` }, { quoted: msg });
  } catch (e) { console.error(e); }
  break;
}
case 'btc':
case 'crypto': {
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
    await socket.sendMessage(sender, { text: `🪙 *CRYPTO PRICES*\n\n₿ Bitcoin: $${data.bitcoin.usd}\nΞ Ethereum: $${data.ethereum.usd}` }, { quoted: msg });
  } catch (e) { console.error(e); }
  break;
}
case 'github':
case 'git': {
  try {
    const user = args[0];
    if(!user) return await socket.sendMessage(sender, {text: "Username එකක් දෙන්න."}, {quoted:msg});
    const { data } = await axios.get(`https://api.github.com/users/${user}`);
    const info = `🐱 *GITHUB PROFILE*\n\n👤 Name: ${data.name}\n📜 Bio: ${data.bio}\n📁 Repos: ${data.public_repos}\n👥 Followers: ${data.followers}\n🔗 URL: ${data.html_url}`;
    await socket.sendMessage(sender, { image: {url: data.avatar_url}, caption: info }, { quoted: msg });
  } catch (e) { await socket.sendMessage(sender, {text: "User not found."}, {quoted:msg}); }
  break;
}

  case 'tr':
case 'translate': {
  try {
    if (!args[0]) return await socket.sendMessage(sender, { text: "පරිවර්තනය කරන්න ඕන වචනය හෝ වාක්‍ය දෙන්න." }, { quoted: msg });
    const text = args.join(" ");
    const { data } = await axios.get(`https://api.mymemory.translated.net/get?q=${text}&langpair=en|si`);
    const translated = data.responseData.translatedText;
    await socket.sendMessage(sender, { text: `🌍 *TRANSLATION*\n\n🔤 Original: ${text}\n🔄 Sinhala: ${translated}` }, { quoted: msg });
  } catch (e) { console.error(e); await socket.sendMessage(sender, { text: "API Error." }, { quoted: msg }); }
  break;
}
case 'wiki': {
  try {
    if (!args[0]) return await socket.sendMessage(sender, { text: "හොයන්න ඕන දේ කියන්න." }, { quoted: msg });
    const query = args.join(" ");
    const { data } = await axios.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${query}`);
    await socket.sendMessage(sender, { text: `🧠 *WIKIPEDIA*\n\n🔍 Topic: ${data.title}\n📄 Summary: ${data.extract}\n🔗 Link: ${data.content_urls.desktop.page}` }, { quoted: msg });
  } catch (e) { await socket.sendMessage(sender, { text: "විස්තර හමු නොවුණි." }, { quoted: msg }); }
  break;
}
case 'weather': {
  try {
    const city = args[0] || 'Colombo';
    const { data } = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=060a6bcfa19809c2cd4d97a212b19273&units=metric`);
    const text = `☁️ *WEATHER REPORT*\n\n🏙️ City: ${data.name}\n🌡️ Temp: ${data.main.temp}°C\n💧 Humidity: ${data.main.humidity}%\n💨 Wind: ${data.wind.speed} m/s\n☁️ Condition: ${data.weather[0].description}`;
    await socket.sendMessage(sender, { text: text }, { quoted: msg });
  } catch (e) { await socket.sendMessage(sender, { text: "නගරය සොයාගත නොහැක." }, { quoted: msg }); }
  break;
}
case 'imdb': {
    if (!text) return reply('Movie name?');
    const { data } = await axios.get(`http://www.omdbapi.com/?apikey=742b2d09&t=${text}&plot=full`);
    reply(`🎬 *${data.Title}*\n📅 Year: ${data.Year}\n⭐ Rating: ${data.imdbRating}\n📝 Plot: ${data.Plot}`);
    break;
}

// 22. NPM (Node Package Search)
case 'npm': {
    if (!text) return reply('Package name?');
    const { data } = await axios.get(`https://registry.npmjs.org/${text}`);
    reply(`📦 *NPM Info*\nName: ${data.name}\nDesc: ${data.description}\nVersion: ${data['dist-tags'].latest}`);
    break;
}
case 'short':
case 'tinyurl': {
  try {
    if (!args[0]) return await socket.sendMessage(sender, { text: "ලින්ක් එකක් දෙන්න." }, { quoted: msg });
    const link = args[0];
    const { data } = await axios.get(`https://tinyurl.com/api-create.php?url=${link}`);
    await socket.sendMessage(sender, { text: `🔗 *SHORT URL*\n\nOriginal: ${link}\nShort: ${data}` }, { quoted: msg });
  } catch (e) { console.error(e); }
  break;
}

  case 'happy':
  try {
    
   
    const emojis = [
      "🙂", "😊", "🤗", "😁", "😄", 
      "😆", "😅", "😂", "🤣", "🙈", 
      "😎", "😜", "😝", "🤩", "🥳", 
      "🎉", "👯", "💃", "🕺", "🔥", "✨"
    ];

   
    let keyMsg = await socket.sendMessage(sender, { text: emojis[0] }, { quoted: msg });

    
    for (let i = 1; i < emojis.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await socket.sendMessage(sender, { text: emojis[i], edit: keyMsg.key });
    }

  } catch (e) {
    console.error('Error in happy command:', e);
  }
  break;
  case 'gay': {
  try {
    const percentage = Math.floor(Math.random() * 100);
    const target = msg.message.extendedTextMessage ? msg.message.extendedTextMessage.contextInfo.participant : sender;
    await socket.sendMessage(sender, { text: `🏳️‍🌈 *Gay Tester*\n\nUser: @${target.split('@')[0]}\nGay Level: *${percentage}%*`, mentions: [target] }, { quoted: msg });
  } catch (e) { console.error(e); }
  break;
}
case 'couple': {
  try {
    const percentage = Math.floor(Math.random() * 100);
    const mentioned = msg.message.extendedTextMessage ? msg.message.extendedTextMessage.contextInfo.participant : sender;
    let comment = percentage > 75 ? "Perfect Match! 💍" : percentage > 50 ? "Good Couple! ❤️" : "Run away! 🏃";
    const text = `💘 *Love Match* 💘\n\n👤 You: @${sender.split('@')[0]}\n👤 Partner: @${mentioned.split('@')[0]}\n\n📊 Compatibility: *${percentage}%*\n📝 Verdict: ${comment}`;
    await socket.sendMessage(sender, { image: {url: config.RCD_IMAGE_PATH}, caption: text, mentions: [sender, mentioned] }, { quoted: msg });
  } catch (e) { console.error(e); }
  break;
}

      case 'jid': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHECKJID1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can use this command.' }, { quoted: shonux });
    }

    const target = args[0] || sender;
    let targetJid = target;

    if (!target.includes('@')) {
      if (target.includes('-')) {
        targetJid = target.endsWith('@g.us') ? target : `${target}@g.us`;
      } else if (target.length > 15) {
        targetJid = target.endsWith('@newsletter') ? target : `${target}@newsletter`;
      } else {
        targetJid = target.endsWith('@s.whatsapp.net') ? target : `${target}@s.whatsapp.net`;
      }
    }

    let type = 'Unknown';
    if (targetJid.endsWith('@g.us')) {
      type = 'Group';
    } else if (targetJid.endsWith('@newsletter')) {
      type = 'Newsletter';
    } else if (targetJid.endsWith('@s.whatsapp.net')) {
      type = 'User';
    } else if (targetJid.endsWith('@broadcast')) {
      type = 'Broadcast List';
    } else {
      type = 'Unknown';
    }

    const responseText = `🔍 *JID INFORMATION*\n\n📌 *Type:* ${type}\n🆔 *JID:* ${targetJid}\n\n╰──────────────────────`;

    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: responseText
    }, { quoted: msg });

  } catch (error) {
    console.error('Checkjid command error:', error);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHECKJID2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error checking JID information!*" }, { quoted: shonux });
  }
  break;
}
         case 'pair': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair +9470604XXXX'
        }, { quoted: msg });
    }

    try {
        const url = `https://senu-md-v5.onrender.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("🌐 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }
		await socket.sendMessage(m.chat, { react: { text: '🔑', key: msg.key } });
        await socket.sendMessage(sender, {
            text: `> *𝐏𝙰𝙸𝚁 𝐂𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳 *✅\n\n*🔑 Your pairing code is:* ${result.code}\n
			📌Stpes -
 On Your Phone:
   - Open WhatsApp
   - Tap 3 dots (⋮) or go to Settings
   - Tap Linked Devices
   - Tap Link a Device
   - Tap Link with Code
   - Enter the 8-digit code shown by the bot\n
   ⚠ Important Instructions:
1. ⏳ Pair this code within 1 minute.
2. 🚫 Do not share this code with anyone.
3. 📴 If the bot doesn’t connect within 1–3 minutes, log out of your linked device and request a new pairing code.
> > 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥`
        }, { quoted: msg });

        await sleep(2000);

        await socket.sendMessage(sender, {
            text: `${result.code}\n> > 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.'
        }, { quoted: msg });
    }

    break;
}
        
    
        // ================== ADVANCED SETTINGS MENU ==================
        case 'setting':
        case 'settings': {
            const sanitized = senderNumber.replace(/[^0-9]/g, '');
            const userConfig = await loadUserConfigFromMongo(sanitized) || {};
            
            // Helper to get ON/OFF emojis
            const getStatus = (status) => (status === 'true' || status === 'on' || status === 'public') ? '✅' : '❌';

            const menuText = `
⚙️ *BOT SETTINGS DASHBOARD* ⚙️
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
 Reply with the number to toggle settings.

1️⃣ *Work Type* [ ${userConfig.WORK_TYPE || 'public'} ]
   ╰ Change Public/Private mode.

2️⃣ *Auto Read Status* [ ${getStatus(userConfig.AUTO_VIEW_STATUS || 'true')} ]
   ╰ Auto view whatsapp statuses.

3️⃣ *Auto Like Status* [ ${getStatus(userConfig.AUTO_LIKE_STATUS || 'true')} ]
   ╰ Auto like whatsapp statuses.

4️⃣ *Auto Recording* [ ${getStatus(userConfig.AUTO_RECORDING || 'false')} ]
   ╰ Show recording while chatting.

5️⃣ *Auto Typing* [ ${getStatus(userConfig.AUTO_TYPING || 'false')} ]
   ╰ Show typing while chatting.

6️⃣ *Anti Call* [ ${getStatus(userConfig.ANTI_CALL || 'off')} ]
   ╰ Auto reject incoming calls.

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
> © ${config.BOT_FOOTER}
`;
            // Sending as a text message so it can be quoted easily, or image with context
            await socket.sendMessage(sender, { 
                image: { url: config.RCD_IMAGE_PATH },
                caption: menuText,
                contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true
                }
            }, { quoted: msg });
            break;
        }
case 'දාපන්':
case 'vv':
case 'save': {
  try {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg) {
      return await socket.sendMessage(sender, { text: '*❌ Please reply to a message (status/media) to save it.*' }, { quoted: msg });
    }

    try { await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch(e){}

    // 🟢 Instead of bot’s own chat, use same chat (sender)
    const saveChat = sender;

    if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage || quotedMsg.documentMessage || quotedMsg.stickerMessage) {
      const media = await downloadQuotedMedia(quotedMsg);
      if (!media || !media.buffer) {
        return await socket.sendMessage(sender, { text: '❌ Failed to download media.' }, { quoted: msg });
      }

      if (quotedMsg.imageMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Status Saved' });
      } else if (quotedMsg.videoMessage) {
        await socket.sendMessage(saveChat, { video: media.buffer, caption: media.caption || '✅ Status Saved', mimetype: media.mime || 'video/mp4' });
      } else if (quotedMsg.audioMessage) {
        await socket.sendMessage(saveChat, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: media.ptt || false });
      } else if (quotedMsg.documentMessage) {
        const fname = media.fileName || `saved_document.${(await FileType.fromBuffer(media.buffer))?.ext || 'bin'}`;
        await socket.sendMessage(saveChat, { document: media.buffer, fileName: fname, mimetype: media.mime || 'application/octet-stream' });
      } else if (quotedMsg.stickerMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Sticker Saved' });
      }

      await socket.sendMessage(sender, { text: '🔥 *𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });

    } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
      const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
      await socket.sendMessage(saveChat, { text: `✅ *𝐒tatus 𝐒aved*\n\n${text}` });
      await socket.sendMessage(sender, { text: '🔥 *𝐓ext 𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });
    } else {
      if (typeof socket.copyNForward === 'function') {
        try {
          const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId || msg.key;
          await socket.copyNForward(saveChat, msg.key, true);
          await socket.sendMessage(sender, { text: '🔥 *𝐒aved (𝐅orwarded) 𝐒uccessfully!*' }, { quoted: msg });
        } catch (e) {
          await socket.sendMessage(sender, { text: '❌ Could not forward the quoted message.' }, { quoted: msg });
        }
      } else {
        await socket.sendMessage(sender, { text: '❌ Unsupported quoted message type.' }, { quoted: msg });
      }
    }

  } catch (error) {
    console.error('❌ Save error:', error);
    await socket.sendMessage(sender, { text: '*❌ Failed to save status*' }, { quoted: msg });
  }
  break;
}
        case 'autotyping': {
            if (!args[0]) return await socket.sendMessage(sender, { text: "Use: .autotyping on/off" });
            const sanitized = senderNumber.replace(/[^0-9]/g, '');
            const userConfig = await loadUserConfigFromMongo(sanitized) || {};
            userConfig.AUTO_TYPING = args[0] === 'on' ? 'true' : 'false';
            await setUserConfigInMongo(sanitized, userConfig);
            await socket.sendMessage(sender, { text: `✅ Auto Typing: ${args[0]}` });
            break;
        }

        case 'autorecording': {
            if (!args[0]) return await socket.sendMessage(sender, { text: "Use: .autorecording on/off" });
            const sanitized = senderNumber.replace(/[^0-9]/g, '');
            const userConfig = await loadUserConfigFromMongo(sanitized) || {};
            userConfig.AUTO_RECORDING = args[0] === 'on' ? 'true' : 'false';
            await setUserConfigInMongo(sanitized, userConfig);
            await socket.sendMessage(sender, { text: `✅ Auto Recording: ${args[0]}` });
            break;
        }

        case 'wtype': {
            if (!args[0]) return await socket.sendMessage(sender, { text: "Use: .wtype public/private/inbox/groups" });
            const sanitized = senderNumber.replace(/[^0-9]/g, '');
            const userConfig = await loadUserConfigFromMongo(sanitized) || {};
            userConfig.WORK_TYPE = args[0];
            await setUserConfigInMongo(sanitized, userConfig);
            await socket.sendMessage(sender, { text: `✅ Work Type: ${args[0]}` });
            break;
        }


        default:
          break;
      }
    } catch (err) {
      console.error('Command handler error:', err);
      try { await socket.sendMessage(sender, { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('❌ ERROR', 'An error occurred while processing your command. Please try again.', BOT_NAME_FANCY) }); } catch(e){}
    }

  });
}

// ---------------- Call Rejection Handler ----------------

async function setupCallRejection(socket, sessionNumber) {
    socket.ev.on('call', async (calls) => {
        try {
            const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
            const userConfig = await loadUserConfigFromMongo(sanitized) || {};
            if (userConfig.ANTI_CALL !== 'on') return;

            console.log(`📞 Incoming call detected for ${sanitized} - Auto rejecting...`);

            for (const call of calls) {
                if (call.status !== 'offer') continue;
                const id = call.id;
                const from = call.from;
                await socket.rejectCall(id, from);
                await socket.sendMessage(from, { text: '*🔕 Auto call rejection is enabled.*' });
                console.log(`✅ Auto-rejected call from ${from}`);
            }
        } catch (err) {
            console.error(`Call rejection error for ${sessionNumber}:`, err);
        }
    });
}

// ---------------- Auto Message Read Handler ----------------

async function setupAutoMessageRead(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    const autoReadSetting = userConfig.AUTO_READ_MESSAGE || 'off';

    if (autoReadSetting === 'off') return;

    let body = '';
    try {
      const type = getContentType(msg.message);
      const actualMsg = (type === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
      if (type === 'conversation') body = actualMsg.conversation || '';
      else if (type === 'extendedTextMessage') body = actualMsg.extendedTextMessage?.text || '';
      else if (type === 'imageMessage') body = actualMsg.imageMessage?.caption || '';
      else if (type === 'videoMessage') body = actualMsg.videoMessage?.caption || '';
    } catch (e) { body = ''; }

    const prefix = userConfig.PREFIX || config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);

    if (autoReadSetting === 'all') {
      try { await socket.readMessages([msg.key]); } catch (error) {}
    } else if (autoReadSetting === 'cmd' && isCmd) {
      try { await socket.readMessages([msg.key]); } catch (error) {}
    }
  });
}

// ---------------- message handlers ----------------

function setupMessageHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
    
    try {
      let autoTyping = config.AUTO_TYPING;
      let autoRecording = config.AUTO_RECORDING;
      
      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
        if (userConfig.AUTO_TYPING !== undefined) autoTyping = userConfig.AUTO_TYPING;
        if (userConfig.AUTO_RECORDING !== undefined) autoRecording = userConfig.AUTO_RECORDING;
      }

      if (autoTyping === 'true') {
        try { 
          await socket.sendPresenceUpdate('composing', msg.key.remoteJid);
          setTimeout(async () => { try { await socket.sendPresenceUpdate('paused', msg.key.remoteJid); } catch (e) {} }, 3000);
        } catch (e) {}
      }
      if (autoRecording === 'true') {
        try { 
          await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
          setTimeout(async () => { try { await socket.sendPresenceUpdate('paused', msg.key.remoteJid); } catch (e) {} }, 3000);
        } catch (e) {}
      }
    } catch (error) {}
  });
}


// ---------------- cleanup helper ----------------

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch(e){}
    try { await removeNumberFromMongo(sanitized); } catch(e){}
    try {
      const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      const caption = formatMessage('👑 OWNER NOTICE — SESSION REMOVED', `Number: ${sanitized}\nSession removed due to logout.\n\nActive sessions now: ${activeSockets.size}`, BOT_NAME_FANCY);
      if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
    } catch(e){}
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ---------------- auto-restart ----------------

function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
                         || lastDisconnect?.error?.statusCode
                         || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
                          || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
                          || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
                          || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      if (isLoggedOut) {
        console.log(`User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch(e){ console.error(e); }
      } else {
        console.log(`Connection closed for ${number} (not logout). Attempt reconnect...`);
        try { await delay(10000); activeSockets.delete(number.replace(/[^0-9]/g,'')); socketCreationTime.delete(number.replace(/[^0-9]/g,'')); const mockRes = { headersSent:false, send:() => {}, status: () => mockRes }; await EmpirePair(number, mockRes); } catch(e){ console.error('Reconnect attempt failed', e); }
      }
    }
  });
}

// ---------------- EmpirePair (pairing, temp dir, persist to Mongo) ----------------

async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  await initMongo().catch(()=>{});
  
  // Prefill from Mongo if available
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

  try {
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      browser: ["Ubuntu", "Chrome", "20.0.04"] 
    });

    socketCreationTime.set(sanitizedNumber, Date.now());

    setupStatusHandlers(socket, sanitizedNumber);
    setupCommandHandlers(socket, sanitizedNumber);
    setupMessageHandlers(socket, sanitizedNumber);
    setupAutoRestart(socket, sanitizedNumber);
    setupNewsletterHandlers(socket, sanitizedNumber);
    handleMessageRevocation(socket, sanitizedNumber);
    setupAutoMessageRead(socket, sanitizedNumber);
    setupCallRejection(socket, sanitizedNumber);

    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try { await delay(1500); code = await socket.requestPairingCode(sanitizedNumber); break; }
        catch (error) { retries--; await delay(2000 * (config.MAX_RETRIES - retries)); }
      }
      if (!res.headersSent) res.send({ code });
    }

    // Save creds to Mongo when updated
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const credsPath = path.join(sessionPath, 'creds.json');
        if (!fs.existsSync(credsPath)) return;
        const fileStats = fs.statSync(credsPath);
        if (fileStats.size === 0) return;
        const fileContent = await fs.readFile(credsPath, 'utf8');
        const trimmedContent = fileContent.trim();
        if (!trimmedContent || trimmedContent === '{}' || trimmedContent === 'null') return;
        let credsObj;
        try { credsObj = JSON.parse(trimmedContent); } catch (e) { return; }
        if (!credsObj || typeof credsObj !== 'object') return;
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
        console.log('✅ Creds saved to MongoDB successfully');
      } catch (err) { 
        console.error('Failed saving creds on creds.update:', err);
      }
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(()=>({ status: 'failed', error: 'joinGroup not configured' }));

          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
              const jid = doc.jid;
              try { if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid); } catch(e){}
            }
          } catch(e){}

          activeSockets.set(sanitizedNumber, socket);
          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;

          const initialCaption = formatMessage(useBotName,
            `✅ සාර්ථකව සම්බන්ධ වෙනු ලැබිය!\n\n🔢 අංකය: ${sanitizedNumber}\n🕒 සම්බන්ධ වීමට: කිහිප විනාඩි කිහිපයකින් BOT ක්‍රියාත්මක වේ\n\n✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n🕒 Connecting: Bot will become active in a few seconds`,
            useBotName
          );

          let sentMsg = null;
          try {
            if (String(useLogo).startsWith('http')) {
              sentMsg = await socket.sendMessage(userJid, { image: { url: useLogo }, caption: initialCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                sentMsg = await socket.sendMessage(userJid, { image: buf, caption: initialCaption });
              } catch (e) {
                sentMsg = await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: initialCaption });
              }
            }
          } catch (e) {
            try { sentMsg = await socket.sendMessage(userJid, { text: initialCaption }); } catch(e){}
          }

          await delay(4000);

          const updatedCaption = formatMessage(useBotName,
            `✅ සාර්ථකව සම්බන්ධ වී, දැන් ක්‍රියාත්මකයි!\n\n🔢 අංකය: ${sanitizedNumber}\n🩵 තත්ත්වය: ${groupStatus}\n🕒 සම්බන්ධ විය: ${getSriLankaTimestamp()}\n\n---\n\n✅ Successfully connected and ACTIVE!\n\n🔢 Number: ${sanitizedNumber}\n🩵 Status: ${groupStatus}\n🕒 Connected at: ${getSriLankaTimestamp()}`,
            useBotName
          );

          try {
            if (sentMsg && sentMsg.key) {
              try { await socket.sendMessage(userJid, { delete: sentMsg.key }); } catch (delErr) {}
            }
            try {
              if (String(useLogo).startsWith('http')) {
                await socket.sendMessage(userJid, { image: { url: useLogo }, caption: updatedCaption });
              } else {
                try {
                  const buf = fs.readFileSync(useLogo);
                  await socket.sendMessage(userJid, { image: buf, caption: updatedCaption });
                } catch (e) {
                  await socket.sendMessage(userJid, { text: updatedCaption });
                }
              }
            } catch (imgErr) {
              await socket.sendMessage(userJid, { text: updatedCaption });
            }
          } catch (e) {}

          await addNumberToMongo(sanitizedNumber);

        } catch (e) { 
          console.error('Connection open error:', e); 
          try { exec(`pm2.restart ${process.env.PM2_NAME || 'CHATUWA-MINI-main'}`); } catch(e) {}
        }
      }
      if (connection === 'close') {
        try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
      }
    });

    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }
}

// ---------------- endpoints ----------------

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  if (activeSockets.has(number.replace(/[^0-9]/g, ''))) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getSriLankaTimestamp() });
});

// initialize mongo & auto-reconnect attempt

initMongo().catch(err => console.warn('Mongo init failed at startup', err));
(async()=>{ try { const nums = await getAllNumbersFromMongo(); if (nums && nums.length) { for (const n of nums) { if (!activeSockets.has(n)) { const mockRes = { headersSent:false, send:()=>{}, status:()=>mockRes }; await EmpirePair(n, mockRes); await delay(500); } } } } catch(e){} })();

module.exports = router;
