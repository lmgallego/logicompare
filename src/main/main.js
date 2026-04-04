const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createMainWindow() {
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

  return win
}

const SPLASH_DURATION_MS = 3800

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 520,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    center: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  splash.loadFile(path.join(__dirname, 'splash.html'))
  return splash
}

function createWindow() {
  const splash = createSplashWindow()

  splash.webContents.once('did-finish-load', () => {
    splash.show()
    setTimeout(() => {
      const main = createMainWindow()
      main.once('ready-to-show', () => {
        if (!splash.isDestroyed()) splash.close()
      })
    }, SPLASH_DURATION_MS)
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

  if (process.argv.includes('--seed-transabadell')) {
    require('./database/seedTransabadell')
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
