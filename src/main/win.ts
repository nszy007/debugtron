import fs from 'fs'
import path from 'path'
import { AppInfo } from '../types'
import {
  enumerateKeys,
  HKEY,
  enumerateValues,
  RegistryValue,
  RegistryValueType,
  RegistryStringEntry,
} from 'registry-js'

function enumRegeditItems(key: HKEY, subkey: string) {
  return enumerateKeys(key, subkey).map(k =>
    enumerateValues(key, subkey + '\\' + k),
  )
}

async function getAppInfoByExePath(
  exePath: string,
  iconPath: string,
  values: readonly RegistryValue[],
): Promise<AppInfo> {
  const displayName = values.find(
    (v): v is RegistryStringEntry =>
      v && v.type === RegistryValueType.REG_SZ && v.name === 'DisplayName',
  )
  let icon = ''
  if (iconPath) {
    const iconBuffer = await fs.promises.readFile(iconPath)
    icon = 'data:image/x-icon;base64,' + iconBuffer.toString('base64')
  }
  return {
    id: exePath,
    name: displayName ? displayName.data : path.basename(exePath, '.exe'),
    icon: icon,
    exePath: exePath,
  }
}

async function getAppInfoFromRegeditItemValues(
  values: readonly RegistryValue[],
): Promise<AppInfo | undefined> {
  if (values.length === 0) return

  let iconPath = ''

  // Try to find executable path of Electron app
  const displayIcon = values.find(
    (v): v is RegistryStringEntry =>
      v && v.type === RegistryValueType.REG_SZ && v.name === 'DisplayIcon',
  )

  if (displayIcon) {
    const icon = displayIcon.data.split(',')[0]
    if (icon.toLowerCase().endsWith('.exe')) {
      if (!fs.existsSync(path.join(icon, '../resources/electron.asar'))) return
      return getAppInfoByExePath(icon, iconPath, values)
    } else if (icon.toLowerCase().endsWith('.ico')) {
      iconPath = icon
    }
  }

  const installLocation = values.find(
    (v): v is RegistryStringEntry =>
      v && v.type === RegistryValueType.REG_SZ && v.name === 'InstallLocation',
  )
  if (installLocation) {
    const dir = installLocation.data
    let files: string[] = []
    try {
      files = await fs.promises.readdir(dir)
    } catch (err) {
      console.error(err, typeof dir)
    }

    if (fs.existsSync(path.join(dir, 'resources/electron.asar'))) {
      const exeFiles = files.filter(file => {
        const lc = file.toLowerCase()
        return (
          lc.endsWith('.exe') &&
          !['uninstall', 'update'].some(keyword => lc.includes(keyword))
        )
      })
      if (exeFiles.length) {
        return getAppInfoByExePath(
          path.join(dir, exeFiles[0]),
          iconPath,
          values,
        ) // FIXME:
      }
    } else {
      const semverDir = files.find(file => /\d+\.\d+\.\d+/.test(file))
      if (
        semverDir &&
        fs.existsSync(path.join(dir, semverDir, 'resources/electron.asar'))
      ) {
        const exeFiles = files.filter(file => {
          const lc = file.toLowerCase()
          return (
            lc.endsWith('.exe') &&
            !['uninstall', 'update'].some(keyword => lc.includes(keyword))
          )
        })
        if (exeFiles.length) {
          return getAppInfoByExePath(
            path.join(dir, exeFiles[0]),
            iconPath,
            values,
          )
        }
      }
    }
  }
}

export async function getAppsOfWin() {
  const items = [
    ...enumRegeditItems(
      HKEY.HKEY_LOCAL_MACHINE,
      'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ),
    ...enumRegeditItems(
      HKEY.HKEY_LOCAL_MACHINE,
      'Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ),
    ...enumRegeditItems(
      HKEY.HKEY_CURRENT_USER,
      'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ),
  ]
  return Promise.all(
    items.map(itemValues => getAppInfoFromRegeditItemValues(itemValues)),
  )
}
