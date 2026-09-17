import type { FolderRecord, FolderRegistry } from './contracts/stores'
import { loadConfig, saveConfig } from './config'
import { TwigraphError } from './errors'
import { canonicalFolderPath, folderIdFor } from './folders'

/**
 * The folder list, backed by the config file.
 *
 * Adding a folder and deleting its index are deliberately separate operations, which is
 * why this only ever writes the list. Removing a folder from the list without removing its
 * index would leave an index nobody can reach, so a caller that removes one is expected to
 * remove the other; the CLI does both.
 */
export function createFolderRegistry(configPath: string): FolderRegistry {
  const write = async (folders: readonly FolderRecord[]): Promise<void> => {
    const config = await loadConfig(configPath)
    await saveConfig(configPath, { ...config, folders })
  }

  const find = async (folderId: string): Promise<FolderRecord | null> => {
    const config = await loadConfig(configPath)
    return config.folders.find((folder) => folder.id === folderId) ?? null
  }

  return {
    list: async (): Promise<readonly FolderRecord[]> => (await loadConfig(configPath)).folders,

    find,

    add: async (folderPath: string, nowMs: number): Promise<FolderRecord> => {
      const canonical = canonicalFolderPath(folderPath)
      const id = folderIdFor(canonical)
      const config = await loadConfig(configPath)

      if (config.folders.some((folder) => folder.id === id)) {
        throw new TwigraphError('FOLDER_ALREADY_INDEXED', 'That folder is already in the list')
      }

      const record: FolderRecord = { id, path: canonical, addedAtMs: nowMs }
      await write([...config.folders, record])
      return record
    },

    update: async (
      folderId: string,
      patch: Partial<Omit<FolderRecord, 'id' | 'path'>>,
    ): Promise<FolderRecord> => {
      const config = await loadConfig(configPath)
      const existing = config.folders.find((folder) => folder.id === folderId)
      if (existing === undefined) {
        throw new TwigraphError('FOLDER_NOT_FOUND', 'That folder is not in the list')
      }

      const updated: FolderRecord = { ...existing, ...patch }
      await write(config.folders.map((folder) => (folder.id === folderId ? updated : folder)))
      return updated
    },

    remove: async (folderId: string): Promise<void> => {
      const config = await loadConfig(configPath)
      if (!config.folders.some((folder) => folder.id === folderId)) {
        throw new TwigraphError('FOLDER_NOT_FOUND', 'That folder is not in the list')
      }
      await write(config.folders.filter((folder) => folder.id !== folderId))
    },
  }
}
