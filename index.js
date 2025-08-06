require('dotenv').config();
const admin = require("firebase-admin");
const moment = require("moment-timezone");
const http = require('http');
const fs = require('fs');

// Set timezone to Asia/Kolkata
process.env.TZ = 'Asia/Kolkata';

// Load service account keys
const serviceAccountKey = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
const serviceAccountKeySecondary = JSON.parse(fs.readFileSync("./serviceAccountKeySecondary.json"));

// Firebase App Initialization
const primaryApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKey),
  databaseURL: "https://esp32-90eef-default-rtdb.firebaseio.com/"
}, "primary");

const secondaryApp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKeySecondary),
  databaseURL: "https://backup-attendance-default-rtdb.firebaseio.com/"
}, "secondary");

const primaryDB = primaryApp.database();
const secondaryDB = secondaryApp.database();

// Maps
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

// Track last reset date
let lastResetDate = "";

function syncData() {
  const today = moment().format("YYYY-MM-DD");
  const primaryRef = primaryDB.ref("/");

  primaryRef.once("value", (snapshot) => {
    const data = snapshot.val();
    const result = {};

    Object.keys(data).forEach((key) => {
      const entry = data[key];
      if (!rollMap[key] || !entry || typeof entry.pre === "undefined") return;

      const roll = rollMap[key];
      const name = nameMap[roll] || "Unknown";
      const { hour, minute, pre } = entry;

      let session = null;
      if (hour === 255 || pre === 0) {
        session = null;
      } else if (hour < 12) {
        session = "FN";
      } else if (hour >= 12 && hour < 17) {
        session = "AN";
      }

      if (!result[roll]) {
        result[roll] = {
          name,
          FN: { status: "Absent" },
          AN: { status: "Absent" }
        };
      }

      if (session) {
        const entryTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        const entryMoment = moment({ hour, minute });

        // Define present/late thresholds
        const isFN = session === "FN";
        const isAN = session === "AN";

        let status = "Absent"; // default fallback

        if (isFN) {
          const start = moment({ hour: 8, minute: 30 });
          const presentCutoff = moment({ hour: 9, minute: 10 });
          const lateCutoff = moment({ hour: 12, minute: 0 });

          if (entryMoment.isBetween(start, presentCutoff, null, "[)")) {
            status = "Present";
          } else if (entryMoment.isBetween(presentCutoff, lateCutoff, null, "[)")) {
            status = "Late";
          }
        }

        if (isAN) {
          const start = moment({ hour: 12, minute: 30 });
          const presentCutoff = moment({ hour: 13, minute: 15 });
          const lateCutoff = moment({ hour: 16, minute: 0 });

          if (entryMoment.isBetween(start, presentCutoff, null, "[)")) {
            status = "Present";
          } else if (entryMoment.isBetween(presentCutoff, lateCutoff, null, "[)")) {
            status = "Late";
          }
        }

        result[roll][session] = {
          status,
          entry_time: entryMoment.format("HH:mm")
        };

      }
    });

    const secondaryRef = secondaryDB.ref(today);

// First, fetch existing attendance to avoid overwriting
secondaryRef.once("value", (existingSnap) => {
  const existingData = existingSnap.val() || {};

  // Merge result with existingData
  Object.keys(result).forEach((roll) => {
    if (!existingData[roll]) {
      existingData[roll] = result[roll]; // new record
    } else {
      // Update only the specific session (FN/AN) without overwriting the other
      existingData[roll].name = result[roll].name; // always update name (safe)
      if (result[roll].FN && result[roll].FN.status !== "Absent") {
        existingData[roll].FN = result[roll].FN;
      }
      if (result[roll].AN && result[roll].AN.status !== "Absent") {
        existingData[roll].AN = result[roll].AN;
      }
    }
  });

  // Write merged data back to DB
  secondaryRef.set(existingData, (err) => {
    if (err) {
      console.error("❌ Failed to sync (merged):", err);
    } else {
      console.log("✅ Synced successfully with session merge for", today);
    }
  });
});

  });
}

function updatePrimaryDataAtEvening() {
  const now = moment().tz("Asia/Kolkata");
  const currentTime = now.format("HH:mm");

  if (currentTime === "15:30") {
    const dataRef = primaryDB.ref("data");
    dataRef.set(1, (err) => {
      if (err) {
        console.error("❌ Failed to update 'data' key in primary DB:", err);
      } else {
        console.log("🌆 'data' key in primary DB updated to 1 at 3:30 PM");
      }
    });
  }
}

function resetAllPreValuesAtMidnight() {
  const now = moment().tz("Asia/Kolkata");
  const currentDate = now.format("YYYY-MM-DD");
  const currentTime = now.format("HH:mm");

  if (currentTime === "00:30" && lastResetDate !== currentDate) {
    const primaryRef = primaryApp.database().ref("/");
    primaryRef.once("value", (snapshot) => {
      const data = snapshot.val();
      for (const key in data) {
        if (data[key] && typeof data[key] === "object" && data[key].hasOwnProperty("pre")) {
          primaryRef.child(key).update({ pre: 0 });
        }
      }
      console.log("🔄 Reset all 'pre' values to 0 at midnight.");
      lastResetDate = currentDate;
    });
  }
}

// Create HTTP server (keep-alive for Render)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('✅ Firebase Sync Service Running\n');
  console.log(`[${new Date().toISOString()}] 🛠 Keep-alive request received`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Server started on port ${PORT}`);

  // Initial sync
  syncData();

  // Periodic tasks
  setInterval(() => {
    syncData();
    updatePrimaryDataAtEvening();
    resetAllPreValuesAtMidnight();
  }, 60 * 1000); // every 1 minute
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] 🧹 Shutting down gracefully`);
  server.close(() => process.exit(0));
});

// Catch uncaught errors
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] ⚠️ Uncaught Exception:`, err.message);
});
