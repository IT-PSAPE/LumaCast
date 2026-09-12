# ADR 0030: Fixed playlist tabs on the Show page

Status: Accepted

## Context

The Show page offered three playlist browser layouts: Current, Tabs, and
Continuous. The choice was exposed in the toolbar, native View menu, and an
Alt+Shift+1–3 shortcut, and was stored beside the independent Grid/List slide
preference. This created parallel render trees and cross-item slide actions for
one screen while making its navigation structure user-configurable.

## Decision

Use playlist tabs as the only Show-page header. The content area always renders
the selected item's slides in Grid or List form. Remove the Current and
Continuous header branches, the continuous browser implementation, its
cross-item slide actions, the playlist-layout controls and commands, and the
playlist-layout shortcut.

Persist only the Grid/List preference in
`lumacast.slide-browser-mode.v1`. During the transition, read a valid
`slideBrowserMode` from `lumacast.deck-browser-preferences.v1` when the new key
does not already supply a valid value, then remove the old JSON key. The
retired `playlistBrowserMode` property is never written to the new key.

## Consequences

The Show page has one navigation and rendering path. Switching a playlist tab
selects the item whose slides are shown; Grid/List continues to control that
selected item's slide presentation. Existing valid Grid/List preferences carry
forward, while stale playlist layout state disappears after the next load.
