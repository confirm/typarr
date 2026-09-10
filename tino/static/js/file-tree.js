import {
  DEBOUNCE_MS,
  FILE_ICON,
  FOLDER_ICON,
  SINGLE_ITEM,
  STATUS_CLASSES,
  STATUS_ICONS,
  TOGGLE_ICON,
  escapeHtml,
} from './constants.js'
import { BucketPicker } from './bucket-picker.js'
import { TreeActions } from './tree-actions.js'
import { TreeBuilder } from './tree-builder.js'
import { TreeDrag } from './tree-drag.js'
import { TreeNewMenu } from './tree-new-menu.js'
import { filterNodes } from './tree-filter.js'

/**
 * Manages the file explorer tree and bucket loading.
 */

export class FileTree {

  /** @param {TinoApp} app - Main application instance. */

  constructor(app) {
    this.app = app
    this.actions = new TreeActions(app)
    this.bucketPicker = new BucketPicker(app)
    this.drag = new TreeDrag(app)
    this.newMenu = new TreeNewMenu(app)
    this.filePaths = new Set()
    this._nodes = []
    this.collapsedPaths = new Set()
  }

  /** Fetch all buckets and auto-select if only one. */

  async loadBuckets() {
    this._buckets = await this.app.api.listBuckets()
    this.app.els.bucketLabel.textContent = this.app.currentBucketLabel()

    if (this._buckets.length === SINGLE_ITEM) {
      const [only] = this._buckets
      this.app.els.bucketLabel.textContent = only.name || only.slug
      await this.app.selectBucket(only.slug, only.role)
    }
  }

  /** Empty the file tree (called when no bucket is selected). */

  clear() {
    this.filePaths = new Set()
    this._nodes = []
    this.app.els.fileTree.innerHTML = ''
  }

  /** Open the bucket picker dialog. */

  openBucketPicker() {
    this.bucketPicker.open()
  }

  /** Bind bucket picker events. */

  bindBucketPicker() {
    this.bucketPicker.bind()
  }

  /** Fetch file list and render the hierarchical tree. */

  _getStorageKey() {
    return this.app.bucket ? `tino_collapsed_${this.app.bucket}` : null
  }

  async loadFiles() {
    const saved = localStorage.getItem(this._getStorageKey())
    this.collapsedPaths = new Set(saved ? JSON.parse(saved) : [])
    
    const files = await this.app.api.listFiles(this.app.bucket)
    this.filePaths = new Set(files.map(fl => fl.path))
    this._nodes = TreeBuilder.build(
      files, this.app.gitStatuses, this._canEdit(),
    )
    this._renderTree()
  }

  /** Force parent folders of a specific path to expand and re-render, then scroll into view */
  
  reveal(filePath) {
    if (!filePath) 
      return
    let currentPath = ''
    let changed = false
    const parts = filePath.split('/')
    parts.pop()
    parts.forEach(part => {
      currentPath += (currentPath ? '/' : '') + part
      if (this.collapsedPaths.delete(currentPath)) 
        changed = true
    })
    if (changed) {
      this._saveCollapsedState()
      this._renderTree()
    }
    setTimeout(() => {
      const safePath = filePath.replace(/"/gu, '\\"')
      const el = this.app.els.fileTree.querySelector(`[data-file="${safePath}"]`)
      if (el)
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
  }

  /** Re-render the tree, applying the current search filter. */

  _renderTree() {
    const query = this.app.els.fileSearch.value
      .trim().toLowerCase()
    const collapsed = query ? new Set() : this.collapsedPaths
    const nodes = filterNodes(this._nodes, query)
    const tree = this.app.els.fileTree
    this._canEditCached = this._canEdit()
    tree.innerHTML = ''
    this._renderNodes(tree, nodes, collapsed)
  }

  _renderNodes(parent, nodes, collapsed) {
    nodes.forEach(node => {
      if (node.type === 'directory')
        this._renderFolder(parent, node, collapsed)
      else
        this._renderFile(parent, node)
    })
  }

  _renderFolder(parent, node, collapsed) {
    const li = document.createElement('li')
    li.className = 'folder-item'
    li.dataset.folder = node.path
    if (this._canEditCached)
      li.draggable = true
    if (collapsed.has(node.path))
      li.classList.add('collapsed')
    this._buildFolderContent(li, node, collapsed)
    parent.appendChild(li)
  }

  _buildFolderContent(li, node, collapsed) {
    const actions = this._canEditCached ? FileTree._folderActionsHtml() : ''
    li.innerHTML =
      `<div class="folder-header">${TOGGLE_ICON}` +
      `${FOLDER_ICON}<span>${escapeHtml(node.name)}</span>` +
      `${actions}</div>`
    const childList = document.createElement('ul')
    childList.className = 'folder-children'
    this._renderNodes(childList, node.children, collapsed)
    li.appendChild(childList)
  }

  static _folderActionsHtml() {
    return '<div class="file-actions">' +
      `${FileTree._btnHtml('folder-new-file', 'New file', 'note_add')}` +
      `${FileTree._btnHtml('folder-new-folder', 'New folder', 'create_new_folder')}` +
      `${FileTree._btnHtml('folder-rename', 'Rename', 'edit')}` +
      `${FileTree._btnHtml('folder-delete', 'Delete', 'delete')}</div>`
  }

  _renderFile(parent, node) {
    const li = document.createElement('li')
    li.className = 'file-item'
    li.dataset.file = node.path
    if (node.status === 'deleted')
      li.classList.add('file-deleted')
    else if (this._canEditCached)
      li.draggable = true
    li.innerHTML = this._fileItemHtml(node)
    if (this.app.currentFile === node.path)
      li.classList.add('active')
    parent.appendChild(li)
  }

  _fileItemHtml(node) {
    const status = node.status || this.app.gitStatuses[node.path]
    const icon = FileTree._leadingIconHtml(status)
    if (!this._canEditCached)
      return `${icon}<span>${escapeHtml(node.name)}</span>`
    const actions = FileTree._fileActionsHtml(status)
    return `${icon}<span>${escapeHtml(node.name)}</span>${actions}`
  }

  static _leadingIconHtml(status) {
    if (!status)
      return FILE_ICON
    return '<span class="material-symbols-outlined file-icon git-status ' +
      `${STATUS_CLASSES[status]}">${STATUS_ICONS[status]}</span>`
  }

  static _btnHtml(cls, title, icon) {
    return `<button class="icon-btn ${cls}" title="${title}">` +
      `<span class="material-symbols-outlined">${icon}</span></button>`
  }

  static _fileActionsHtml(status) {
    if (status === 'deleted')
      return `<div class="file-actions">${FileTree._btnHtml('file-reset', 'Restore', 'undo')}</div>`
    let resetBtn = ''
    if (status && status !== 'untracked')
      resetBtn = FileTree._btnHtml('file-reset', 'Reset', 'undo')
    return '<div class="file-actions">' +
      `${FileTree._btnHtml('file-rename', 'Rename', 'edit')}${resetBtn}` +
      `${FileTree._btnHtml('file-delete', 'Delete', 'delete')}</div>`
  }

  _canEdit() {
    return this.app.bucketRole === 'editor'
      || this.app.bucketRole === 'committer'
  }

  /** Bind the file search input to re-render on typing. */

  bindSearch() {
    let timeout = null
    this.app.els.fileSearch.addEventListener('input', () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => this._renderTree(), DEBOUNCE_MS)
    })
  }

  /** Bind the "New" menu in the explorer header (file / folder / template). */

  bindNewMenu() {
    this.newMenu.bind()
  }

  /** Bind click events on the file tree. */

  bindTreeClicks() {
    this.app.els.fileTree.addEventListener('click', evt => {
      const folder = evt.target.closest('.folder-header')
      if (folder) {
        this._handleFolderClick(evt, folder)
        return
      }
      this._handleFileClick(evt)
    })
  }

  _handleFolderClick(evt, folder) {
    const folderItem = folder.closest('.folder-item')
    const folderPath = folderItem.dataset.folder
    if (evt.target.closest('.folder-new-file'))
      this.actions.createFileInFolder(folderPath)
    else if (evt.target.closest('.folder-new-folder'))
      this.actions.createFolder(`${folderPath}/`)
    else if (evt.target.closest('.folder-delete'))
      this.actions.deleteFolder(folderPath)
    else if (evt.target.closest('.folder-rename'))
      this.actions.renameFolder(folderPath)
    else {
      if (folderItem.classList.toggle('collapsed'))
        this.collapsedPaths.add(folderPath)
      else
        this.collapsedPaths.delete(folderPath)
      this._saveCollapsedState()
    }
  }

  /** Bind drag-and-drop upload on the file explorer panel. */

  bindUploadDrop() {
    this.drag.bindUploadDrop()
  }

  /** Bind drag-and-drop events for moving files and folders in the tree. */

  bindTreeDrag() {
    this.drag.bindTreeDrag()
  }

  _handleFileClick(evt) {
    const item = evt.target.closest('.file-item')
    if (!item)
      return
    const filePath = item.dataset.file
    if (evt.target.closest('.file-delete'))
      this.actions.deleteFile(filePath)
    else if (evt.target.closest('.file-rename'))
      this.actions.renameFile(filePath)
    else if (evt.target.closest('.file-reset'))
      this.actions.resetFile(filePath)
    else if (!item.classList.contains('file-deleted'))
      this.app.editor.openFile(filePath)
  }

  _saveCollapsedState() {
    localStorage.setItem(this._getStorageKey(), JSON.stringify([...this.collapsedPaths]))
  }

}
