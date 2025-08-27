// index.js
require('dotenv').config();
const admin = require('firebase-admin');
const moment = require('moment-timezone');
const http = require('http');
const fs = require('fs');

// --- CONFIG ---
// Set timezone
const TZ = 'Asia/Kolkata';
process.env.TZ = TZ;

// Load service account keys (files must exist)
const serviceAccountKey = JSON.parse(fs.readFileSync('./serviceAccountKey.json'));
const serviceAccountKeySecondary = JSON.parse(fs.readFileSync('./serviceAccountKeySecondary.json'));

// Replace with your real DB URLs or set in environment variables
const PRIMARY_DB_URL = process.env.PRIMARY_DB_URL || 'https://esp32-90eef-default-rtdb.firebaseio.com/';
const SECONDARY_DB_URL = process.env.SECONDARY_DB_URL || 'https://backup-attendance-default-rtdb.firebaseio.com/';

// Initialize Firebase apps
const primaryApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKey),
  databaseURL: PRIMARY_DB_URL
}, 'primary');

const secondaryApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKeySecondary),
  databaseURL: SECONDARY_DB_URL
}, 'secondary');

const primaryDB = primaryApp.database();
const secondaryDB = secondaryApp.database();

// --- Student / Roll maps (use your full map) ---
const rollMap = {
  "1": "2907", "2": "2908", "3": "2909", "4": "2910", "5": "2911", "6": "2912",
  "7": "2913", "8": "2914", "9": "2915", "10": "2916", "11": "2917", "12": "2918",
  "13": "2919", "14": "2920", "15": "2921", "16": "2922", "17": "2923", "18": "2924",
  "19": "2925", "20": "2926", "21": "2927", "22": "2928", "23": "2929", "24": "2930",
  "25": "2931", "26": "2932", "27": "2933", "28": "2934", "29": "2935", "30": "2936",
  "31": "2937", "32": "2938", "33": "2939", "34": "2940", "35": "2941", "36": "2942",
  "37": "2943", "38": "2944", "39": "2945", "40": "2946", "41": "2947", "42": "2948",
  "43": "2949", "44": "2950", "45": "2951", "46": "2952", "47": "2953", "48": "2954",
  "49": "2955", "50": "2956", "51": "2957", "52": "2958", "54": "2960", "55": "2961",
  "56": "2962", "57": "2963", "58": "2964", "59": "2965", "60": "2966", "61": "2967",
  "63": "2969", "64": "3287", "65": "3286"
};

const nameMap = {
  "2907": "AARUSH JEIMEN M", "2908": "ABINASH MICHEL M", "2909": "ABINESH F", "2910": "ABISHA P",
  "2911": "ABISHA R", "2912": "ADLIN DINO T", "2913": "AKISHA S G", "2914": "AKSHAYA S",
  "2915": "ALDRIN SAHAYA RAJ S", "2916": "ANCY ANOLA K", "2917": "ARSHA M B", "2918": "ARTHI R A",
  "2919": "ASHIKA BENSY A B", "2920": "ASHLIN SHIJO J", "2921": "ASHMIN SHEENA C", "2922": "ASLIN M",
  "2923": "ASRUTHI S A", "2924": "BABISHA R", "2925": "BERIN Y V", "2926": "DANIEL D",
  "2927": "DANUSH S D", "2928": "DERLIN JENISH E S", "2929": "DHARSHINISRI T", "2930": "DHIMNA",
  "2931": "DUSHYANTH N S", "2932": "EVANGELIN SWEET ROSE J", "2933": "GEO RASHMA P", "2934": "GODSON S",
  "2935": "HARISON PRAPHU D J", "2936": "IJAZ AHAMED P", "2937": "JACKSON GEO M", "2938": "JASMINE J",
  "2939": "JEEVA RAJAN J M", "2940": "JENISHA D", "2941": "KANAGALAKSHMI G", "2942": "LEVIYA V",
  "2943": "LISIBA I", "2944": "MADHUMITHA V", "2945": "MAHISHADEVI N", "2946": "MANISHA J R",
  "2947": "MARIA SANIYA M", "2948": "MUSTAQ AHAMED A", "2949": "NAMITH D", "2950": "NANTHITHA R",
  "2951": "NISHA R", "2952": "NISHMI T S", "2953": "NIVETHA S", "2954": "PRAVIN G S",
  "2955": "RAGUL N", "2956": "RAMGOPAL A", "2957": "RIYA DEV C", "2958": "ROHAN FEDRAL E",
  "2960": "SARAVANAN P", "2961": "SELVA DOMINI BESHI ROY S B", "2962": "SHARLIN R", "2963": "SHIBIN RAJ S",
  "2964": "SINJU S S", "2965": "SUJAYAN C K", "2966": "VENKATESA PERUMAL G", "2967": "VIBISHA J D",
  "2969": "YOSUVA JOBIN M", "3287": "GOPI V R", "3286": "JAIJOTHI K"
};

// --- Utilities ---
function now() {
  return moment().tz(TZ);
}

function timeStringFromHM(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// --- Main sync function ---
// This reads the primary DB root, determines Present/Late/Absent for FN & AN
// and merges non-absent session results into secondary DB under today's date.
async function syncData() {
  const t = now();
  const currentTime = t.format('HH:mm');

  // Only run syncing process between 08:00 and 15:00 (inclusive start, inclusive end)
  const startWork = moment.tz({ hour: 8, minute: 0 }, TZ);
  const endWork = moment.tz({ hour: 15, minute: 0 }, TZ);

  if (t.isBefore(startWork) || t.isAfter(endWork)) {
    console.log(`⏸ [${currentTime}] Outside working window (08:00-15:00). Skipping sync.`);
    return;
  }

  const today = t.format('YYYY-MM-DD');
  try {
    const snapshot = await primaryDB.ref('/').once('value');
    const data = snapshot.val() || {};

    // Start with default Absent for all students
    const result = {};
    Object.keys(rollMap).forEach(key => {
      const roll = rollMap[key];
      result[roll] = {
        name: nameMap[roll] || 'Unknown',
        FN: { status: 'Absent' },
        AN: { status: 'Absent' }
      };
    });

    // Process each record from primary DB
    Object.keys(data).forEach(k => {
      const entry = data[k];
      if (!rollMap[k] || !entry) return;

      const roll = rollMap[k];
      // Expect fields: pre (0/1), hour (0-23 or 255), minute
      const pre = typeof entry.pre === 'undefined' ? 0 : entry.pre;
      const hour = typeof entry.hour === 'undefined' ? 255 : entry.hour;
      const minute = typeof entry.minute === 'undefined' ? 0 : entry.minute;

      if (pre !== 1) return;      // not scanned / not present
      if (hour === 255) return;   // invalid hour flag from device

      const entryMoment = moment.tz({ hour, minute }, TZ);

      // FN: any hour < 12
      if (hour < 12) {
        const fnStart = moment.tz({ hour: 8, minute: 0 }, TZ);
        const fnPresentEnd = moment.tz({ hour: 9, minute: 10 }, TZ); // present cutoff
        const fnLateEnd = moment.tz({ hour: 12, minute: 0 }, TZ);    // FN session end

        if (entryMoment.isBetween(fnStart, fnPresentEnd, null, '[)')) {
          result[roll].FN = { status: 'Present', entry_time: entryMoment.format('HH:mm') };
        } else if (entryMoment.isBetween(fnPresentEnd, fnLateEnd, null, '[)')) {
          result[roll].FN = { status: 'Late', entry_time: entryMoment.format('HH:mm') };
        }
        // else remains Absent
      }

      // AN: hour >= 12
      if (hour >= 12) {
        const anPresentStart = moment.tz({ hour: 12, minute: 35 }, TZ);
        const anPresentEnd = moment.tz({ hour: 13, minute: 15 }, TZ);
        const anLateEnd = moment.tz({ hour: 15, minute: 0 }, TZ);

        if (entryMoment.isBetween(anPresentStart, anPresentEnd, null, '[)')) {
          result[roll].AN = { status: 'Present', entry_time: entryMoment.format('HH:mm') };
        } else if (entryMoment.isBetween(anPresentEnd, anLateEnd, null, '[)')) {
          result[roll].AN = { status: 'Late', entry_time: entryMoment.format('HH:mm') };
        }
        // else remains Absent
      }
    });

    // Merge result into secondary DB under today's date.
    const secRef = secondaryDB.ref(`/${today}`);
    const existingSnap = await secRef.once('value');
    const existing = existingSnap.val() || {};

    Object.keys(result).forEach(roll => {
      if (!existing[roll]) {
        existing[roll] = result[roll];
      } else {
        // Always keep/overwrite name
        existing[roll].name = result[roll].name;
        // Only overwrite FN/AN if status is not Absent (so we don't revert an earlier Present)
        if (result[roll].FN && result[roll].FN.status !== 'Absent') {
          existing[roll].FN = result[roll].FN;
        }
        if (result[roll].AN && result[roll].AN.status !== 'Absent') {
          existing[roll].AN = result[roll].AN;
        }
      }
    });

    await secRef.set(existing);
    console.log(`✅ [${currentTime}] Synced attendance to secondary DB for ${today}`);
  } catch (err) {
    console.error(`❌ [${t.format('HH:mm')}] Sync failed:`, err);
  }
}

// --- Finalize functions ---
// At 12:00 mark FN Absent for anyone who still doesn't have FN recorded.
// At 15:00 mark AN Absent for anyone who still doesn't have AN recorded.
async function finalizeSessionIfNeeded() {
  const t = now();
  const today = t.format('YYYY-MM-DD');
  const hh = t.hours();
  const mm = t.minutes();

  try {
    const secRef = secondaryDB.ref(`/${today}`);
    const snap = await secRef.once('value');
    const existing = snap.val() || {};

    // helper to ensure student node exists
    function ensureStudent(roll) {
      if (!existing[roll]) {
        existing[roll] = {
          name: nameMap[roll] || 'Unknown',
          FN: { status: 'Absent' },
          AN: { status: 'Absent' }
        };
      } else {
        existing[roll].name = nameMap[roll] || existing[roll].name || 'Unknown';
        if (!existing[roll].FN) existing[roll].FN = { status: 'Absent' };
        if (!existing[roll].AN) existing[roll].AN = { status: 'Absent' };
      }
    }

    // Finalize FN at exactly 12:00 (we'll run at 12:00 or soon after)
    if (hh === 12 && mm === 0) {
      Object.values(rollMap).forEach(roll => {
        ensureStudent(roll);
        if (!existing[roll].FN || existing[roll].FN.status === undefined || existing[roll].FN.status === null) {
          existing[roll].FN = { status: 'Absent', entry_time: '--:--' };
        } else if (existing[roll].FN.status === 'Absent' && !existing[roll].FN.entry_time) {
          existing[roll].FN.entry_time = '--:--';
        }
      });
      await secRef.set(existing);
      console.log(`🕛 FN finalized (marked Absent where missing) for ${today}`);
    }

    // Finalize AN at exactly 15:00
    if (hh === 15 && mm === 0) {
      Object.values(rollMap).forEach(roll => {
        ensureStudent(roll);
        if (!existing[roll].AN || existing[roll].AN.status === undefined || existing[roll].AN.status === null) {
          existing[roll].AN = { status: 'Absent', entry_time: '--:--' };
        } else if (existing[roll].AN.status === 'Absent' && !existing[roll].AN.entry_time) {
          existing[roll].AN.entry_time = '--:--';
        }
      });
      await secRef.set(existing);
      console.log(`🕒 AN finalized (marked Absent where missing) for ${today}`);
    }
  } catch (err) {
    console.error('❌ Finalize session error:', err);
  }
}

// --- Reset primary DB pre/hour/minute at 00:30 ---
let lastResetDay = null;
async function resetPrimaryPreHourMinute() {
  const t = now();
  const today = t.format('YYYY-MM-DD');
  const hh = t.hours();
  const mm = t.minutes();

  if (hh === 16 && mm === 0 && lastResetDay !== today) {
    try {
      const rootSnap = await primaryDB.ref('/').once('value');
      const data = rootSnap.val() || {};
      const updates = {};

      Object.keys(data).forEach(k => {
        if (data[k] && typeof data[k] === 'object') {
          // Only update when those keys exist (and avoid overwriting unrelated fields).
          updates[`/${k}/pre`] = 0;
          updates[`/${k}/hour`] = 255;   // using 255 as invalid hour flag (same as earlier)
          updates[`/${k}/minute`] = 0;
        }
      });

      // Apply updates in one multi-path update
      if (Object.keys(updates).length > 0) {
        await primaryDB.ref('/').update(updates);
      }

      lastResetDay = today;
      console.log(`🔄 Primary DB reset (pre/hour/minute) at 16:00 for ${today}`);
    } catch (err) {
      console.error('❌ Reset primary DB error:', err);
    }
  }
}

// --- At 16:00 add { data: 1 } in main root of secondary DB ---
let lastDataFlagDay = null;
async function writeDailyDataFlag() {
  const t = now();
  const today = t.format('YYYY-MM-DD');
  const hh = t.hours();
  const mm = t.minutes();

  // 16:00 condition
  if (hh === 16 && mm === 0 && lastDataFlagDay !== today) {
    try {
      await primaryDB.ref("/").update({ data: 1 });  // write at root, not under date
      lastDataFlagDay = today;
      console.log(`📌 Wrote { data: 1 } to secondary DB root at 16:00`);
    } catch (err) {
      console.error('❌ Failed to write daily data flag:', err);
    }
  }
}


// --- Periodic loop (runs every minute) ---
async function periodicTasks() {
  try {
    await syncData();                 // runs only during 08:00-15:00
    await finalizeSessionIfNeeded();  // finalize at 12:00 and 15:00
    await resetPrimaryPreHourMinute();// reset at 00:30
    await writeDailyDataFlag();       // write flag at 16:00
  } catch (err) {
    console.error('❌ periodicTasks error:', err);
  }
}

// Start server for keep-alive (useful for Render/Heroku style hosts)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('✅ Attendance Sync Service Running\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT} (${TZ})`);
  // Run once immediately, then every minute
  periodicTasks();
  setInterval(periodicTasks, 60 * 1000);
});

// graceful shutdown
process.on('SIGTERM', () => {
  console.log('🧹 SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
  // do not exit so host can attempt restart; adjust policy if desired
});
