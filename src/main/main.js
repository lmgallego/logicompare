const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f6fafe',
      symbolColor: '#171c1f',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
    backgroundColor: '#f6fafe',
    show: false,
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/dist/index.html'))
  }

  win.once('ready-to-show', () => {
    win.show()
  })
}

app.whenReady().then(() => {
  const { getDb } = require('./database/connection')
  getDb() // initialize DB + run migrations

  if (process.argv.includes('--seed')) {
    require('./database/seedGls')
    app.quit()
    return
  }

  if (process.argv.includes('--seed-logistica')) {
    require('./database/seedLogistica')
    app.quit()
    return
  }

  if (process.argv.includes('--seed-dhl')) {
    require('./database/seedDhl')
    app.quit()
    return
  }

  if (process.argv.includes('--seed-seur')) {
    require('./database/seedSeur')
    app.quit()
    return
  }

  if (process.argv.includes('--seed-transhaer')) {
    require('./database/seedTranshaer')
    app.quit()
    return
  }

  require('./ipcHandlers/quoteHandler')
  require('./ipcHandlers/agencyHandler')
  require('./ipcHandlers/provinceHandler')
  require('./ipcHandlers/windowHandler')

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
