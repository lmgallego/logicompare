/**
 * Converts src/main/assets/elmer.png to assets/icon.ico
 * Uses only Node.js built-ins — no external deps required.
 * Produces a single 256×256 ICO (PNG-compressed, supported by Windows Vista+).
 */
const fs = require('fs')
const path = require('path')

const srcPng = path.join(__dirname, '../src/main/assets/elmer.png')
const destIco = path.join(__dirname, '../assets/icon.ico')

// Ensure assets/ directory exists
const assetsDir = path.join(__dirname, '../assets')
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true })

const pngData = fs.readFileSync(srcPng)

// ICO format: ICONDIR + ICONDIRENTRY + PNG data
// For 256x256 PNG-compressed ICO (single image):
// - Width/Height in ICONDIRENTRY = 0 (means 256)
const ICONDIR = Buffer.alloc(6)
ICONDIR.writeUInt16LE(0, 0)      // Reserved
ICONDIR.writeUInt16LE(1, 2)      // Type: 1 = ICO
ICONDIR.writeUInt16LE(1, 4)      // Image count: 1

const ICONDIRENTRY = Buffer.alloc(16)
ICONDIRENTRY.writeUInt8(0, 0)        // Width: 0 = 256
ICONDIRENTRY.writeUInt8(0, 1)        // Height: 0 = 256
ICONDIRENTRY.writeUInt8(0, 2)        // Color count: 0 = no palette
ICONDIRENTRY.writeUInt8(0, 3)        // Reserved
ICONDIRENTRY.writeUInt16LE(1, 4)     // Planes
ICONDIRENTRY.writeUInt16LE(32, 6)    // Bit count
ICONDIRENTRY.writeUInt32LE(pngData.length, 8)   // Size of image data
ICONDIRENTRY.writeUInt32LE(6 + 16, 12)          // Offset: after ICONDIR + ICONDIRENTRY

const ico = Buffer.concat([ICONDIR, ICONDIRENTRY, pngData])
fs.writeFileSync(destIco, ico)

console.log(`✅ ICO creado: ${destIco} (${(ico.length / 1024).toFixed(1)} KB)`)
