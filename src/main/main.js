const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

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

function showMain(main, splash) {
  const elapsed = Date.now() - startTime
  const remaining = Math.max(0, SPLASH_DURATION_MS - elapsed)
  setTimeout(() => {
    if (splash && !splash.isDestroyed()) splash.close()
    if (!main.isDestroyed()) main.show()
  }, remaining)
}

function createWindow() {
  if (isDev) {
    const main = createMainWindow()
    main.once('ready-to-show', () => main.show())
    return
  }

  // Production: show splash while main window loads, then swap
  const splash = createSplashWindow()
  splash.webContents.once('did-finish-load', () => splash.show())

  const main = createMainWindow()

  // Show main when page is loaded (ready-to-show or did-finish-load)
  main.webContents.once('did-finish-load', () => showMain(main, splash))

  // Fallback: if load fails, show anyway with an error visible
  main.webContents.once('did-fail-load', (_e, code, desc) => {
    dialog.showErrorBox('Error al cargar', `No se pudo cargar la interfaz.\nCódigo: ${code}\n${desc}`)
    showMain(main, splash)
  })

  // Safety fallback: if neither fires within 10s, show anyway
  setTimeout(() => {
    if (!main.isDestroyed() && !main.isVisible()) showMain(main, splash)
  }, 10000)
}

const startTime = Date.now()

async function checkFirstRun() {
  const { getDb } = require('./database/connection')
  const db = getDb()
  const { app: electronApp } = require('electron')

  const agencyCount = db.prepare('SELECT COUNT(*) as n FROM agencias').get().n
  if (agencyCount > 0) return  // already has data, skip

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'LogiCompare — Primer arranque',
    message: '¿Quieres importar una base de datos existente?',
    detail: 'Si ya tienes una copia de LogiCompare en otro ordenador puedes importar su base de datos para mantener agencias y tarifas.\n\nSi es la primera instalación pulsa "Empezar vacío".',
    buttons: ['Importar base de datos...', 'Empezar vacío'],
    defaultId: 0,
    cancelId: 1,
  })

  if (response === 0) {
    const result = await dialog.showOpenDialog({
      title: 'Selecciona la base de datos de LogiCompare',
      filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
      properties: ['openFile'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const srcPath = result.filePaths[0]
      const destPath = path.join(electronApp.getPath('userData'), 'logicompare.db')
      try {
        // Close current DB before overwriting
        db.close()
        fs.copyFileSync(srcPath, destPath)
        dialog.showMessageBoxSync({
          type: 'info',
          title: 'Base de datos importada',
          message: 'La base de datos se ha importado correctamente.',
          detail: 'La aplicación se reiniciará para cargar los datos.',
          buttons: ['Aceptar'],
        })
        electronApp.relaunch()
        electronApp.exit(0)
      } catch (err) {
        dialog.showMessageBoxSync({
          type: 'error',
          title: 'Error al importar',
          message: 'No se pudo copiar la base de datos: ' + err.message,
          buttons: ['Aceptar'],
        })
      }
    }
  }
}

app.whenReady().then(async () => {
  try {
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
    require('./ipcHandlers/supportHandler').init()

    ipcMain.removeHandler('get-app-version')
    ipcMain.handle('get-app-version', () => app.getVersion())

    // Import DB from support page (any time, not just first run)
    ipcMain.removeHandler('import-db')
    ipcMain.handle('import-db', async () => {
      const { getDb } = require('./database/connection')
      const result = await dialog.showOpenDialog({
        title: 'Selecciona la base de datos de LogiCompare',
        filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false }
      const srcPath = result.filePaths[0]
      const destPath = path.join(app.getPath('userData'), 'logicompare.db')
      try {
        getDb().close()
        fs.copyFileSync(srcPath, destPath)
        app.relaunch()
        app.exit(0)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })

    // Export current DB (backup/share)
    ipcMain.removeHandler('export-db')
    ipcMain.handle('export-db', async () => {
      const srcPath = path.join(app.getPath('userData'), 'logicompare.db')
      const { filePath } = await dialog.showSaveDialog({
        title: 'Guardar copia de la base de datos',
        defaultPath: 'logicompare_backup_' + new Date().toISOString().slice(0, 10) + '.db',
        filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
      })
      if (!filePath) return { ok: false }
      try {
        fs.copyFileSync(srcPath, filePath)
        return { ok: true, filePath }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })

    await checkFirstRun()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    dialog.showErrorBox(
      'LogiCompare — Error de inicio',
      'La aplicación no ha podido iniciarse.\n\n' + err.message + '\n\n' + (err.stack || '')
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
