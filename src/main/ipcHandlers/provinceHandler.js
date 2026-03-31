const { ipcMain } = require('electron')
const { getAll, getByPrefix } = require('../repositories/provinciaRepository')

ipcMain.handle('get-provincias', () => getAll())

ipcMain.handle('get-provincia-by-prefix', (event, cpPrefix) => getByPrefix(cpPrefix))
