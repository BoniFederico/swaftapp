---
title: Keyboard shortcuts
layout: default
parent: User guide
nav_order: 10
---

# Keyboard shortcuts
{: .no_toc }

On macOS, use **Cmd** wherever this page says **Ctrl**, unless a separate macOS key is given.
{: .fs-6 .fw-300 }

<details open markdown="block">
  <summary>Table of contents</summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

---

## Saving

| Shortcut | Where | Action |
|----------|-------|--------|
| **Ctrl+S** | Template editor | Save the selected version. |
| **Ctrl+S** | API view | Save the request. |
| **Ctrl+S** | Document view | Save the input config (**Save input config**). |
| **Ctrl+S** | Code view | Save the capability or action code. |
| **Ctrl+S** | Folder view | Save the folder's settings. |
| **Ctrl+S** | Scenario canvas | Save the scenario. |

The shortcut acts on the **active tab** only. While the template editor (or another dialog) is
open, it applies to that dialog.

## Code editor

These work in every source editor — the template editor, the Code view, request bodies and other
code fields.

| Shortcut | Action |
|----------|--------|
| **Ctrl+F** | Open find & replace (also in read-only views). |
| **F3** or **Ctrl+G** | Find next. |
| **Shift+F3** or **Shift+Ctrl+G** | Find previous. |
| **Esc** | Close the find panel (or the autocomplete list). |
| **Ctrl+D** | Select the next occurrence of the selection. |
| **Ctrl+Shift+L** | Select all occurrences of the selection. |
| **Ctrl+Alt+G** | Go to line. |
| **Ctrl+Z** | Undo. |
| **Ctrl+Y** (macOS: **Cmd+Shift+Z**; Linux also **Ctrl+Shift+Z**) | Redo. |
| **Tab** / **Shift+Tab** | Indent / outdent. |
| **Ctrl+Space** (macOS also **Alt+`** or **Alt+I**) | Open autocompletion. |
| **↑** / **↓**, **Page Up** / **Page Down**, **Enter** | Move through and accept a completion. |

Standard text-editing keys (cursor movement, selection, line operations) follow CodeMirror's
defaults.

## Scenario canvas

These apply in the scenario view while no text field (an alias, a condition, a batch count…) has
focus.

| Shortcut | Action |
|----------|--------|
| **Ctrl+Z** | Undo. |
| **Ctrl+Shift+Z** or **Ctrl+Y** | Redo. |
| **Delete** or **Backspace** | Delete the selected node or connection (with its connections). Use **Undo** to restore it. |
| **Esc** | Close the block menu. |
| Mouse wheel | Zoom in and out. |

## Navigation and dialogs

| Shortcut | Where | Action |
|----------|-------|--------|
| **Enter** or **Space** | Working Tree | Open the focused template or folder. |
| **Tab** / **Shift+Tab** | Everywhere | Move focus between controls. |
| **←** **→** **↑** **↓** | **Create template** dialog | Choose the template type. |
| **Enter** | Tag bar (**Add tag…**) | Add the typed or highlighted tag. |
| **↑** / **↓** | Tag bar | Move through tag suggestions. |
| **Esc** | Dialogs, menus, **Settings**, tag suggestions | Close. |
