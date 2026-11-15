"""Writes AMP Mobile's icon set: assets/icons/<name>.svg (24x24, white line art the app tints) and
src/components/Icon.tsx (the component and the name list).
Run: python3 scripts/make-icons.py "$PWD" from the repository root."""
import os
import sys

ROOT = sys.argv[1]
S = 'fill="none" stroke="#ffffff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'
F = 'fill="#ffffff" stroke="none"'

# name: (what it stands for, inner SVG). Line art unless an element sets F.
ICONS = {
    # Marks and states
    "check": ("Done, selected, succeeded", '<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    "x": ("Failed, closed", '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    "plus": ("Add, new", '<path d="M12 5v14M5 12h14"/>'),
    "circle": ("Off, idle", '<circle cx="12" cy="12" r="6.5"/>'),
    "dot": ("A point in a list", f'<circle cx="12" cy="12" r="3.5" {F}/>'),
    "exclaim": ("Needs attention", '<path d="M12 5.5v9"/><path d="M12 18.5v.01" stroke-width="2.5"/>'),
    "info": ("About, information", '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6v.01" stroke-width="2.5"/>'),
    "warning": ("Warning, careful", '<path d="M10.3 4.3L2.9 17.5A2 2 0 004.6 20.5h14.8a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z"/><path d="M12 9.5v4.5"/><path d="M12 17v.01" stroke-width="2.5"/>'),
    "ban": ("Revoke, blocked, suspended", '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
    # Navigation
    "chevron-down": ("Open (collapsed)", '<path d="M6 9.5l6 6 6-6"/>'),
    "chevron-up": ("Close (expanded)", '<path d="M6 14.5l6-6 6 6"/>'),
    "chevron-right": ("Go into", '<path d="M9.5 6l6 6-6 6"/>'),
    "chevron-left": ("Back", '<path d="M14.5 6l-6 6 6 6"/>'),
    "more": ("More actions", f'<circle cx="5.5" cy="12" r="1.8" {F}/><circle cx="12" cy="12" r="1.8" {F}/><circle cx="18.5" cy="12" r="1.8" {F}/>'),
    "arrow-right": ("Leads to", '<path d="M4 12h15.5M13.5 6l6 6-6 6"/>'),
    "arrow-up": ("Up, sent", '<path d="M12 19.5V5M6 11l6-6 6 6"/>'),
    "arrow-down": ("Down, received", '<path d="M12 4.5V19M6 13l6 6 6-6"/>'),
    "swap": ("Both ways (a tunnel)", '<path d="M4 8h14.5M14.5 4l4 4-4 4M20 16H5.5M9.5 12l-4 4 4 4"/>'),
    "corner-down-right": ("A step under another", '<path d="M6 4.5v7.5a3 3 0 003 3h10.5M15 11l4.5 4-4.5 4"/>'),
    "caret-up": ("Went up", f'<path d="M12 6.5l7 10H5z" {F}/>'),
    "caret-down": ("Went down", f'<path d="M12 17.5l-7-10h14z" {F}/>'),
    "backspace": ("Delete a digit", '<path d="M9 5h10.5A1.5 1.5 0 0121 6.5v11a1.5 1.5 0 01-1.5 1.5H9l-6.5-7z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/>'),
    "search": ("Search", '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
    # Files and editing
    "trash": ("Delete", '<path d="M4 6.5h16M9.5 6.5V4.5h5v2"/><path d="M6 6.5l1 13a1.5 1.5 0 001.5 1.4h7a1.5 1.5 0 001.5-1.4l1-13"/><path d="M10 10.5v6.5M14 10.5v6.5"/>'),
    "pencil": ("Edit", '<path d="M4 20l1-4.5L15.8 4.7a2.1 2.1 0 013 3L8 18.5z"/><path d="M13.8 6.7l3 3"/>'),
    "note": ("Edit a description, unsaved text", '<path d="M13 4H6A1.5 1.5 0 004.5 5.5v13A1.5 1.5 0 006 20h12a1.5 1.5 0 001.5-1.5V12"/><path d="M8 10h3.5M8 14h6"/><path d="M15.5 9.5l5-5"/><path d="M18 3.5l2.5 2.5"/>'),
    "file": ("A file", '<path d="M14 3H6.5A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V8z"/><path d="M14 3v5h5"/>'),
    "file-text": ("A text file, a document", '<path d="M14 3H6.5A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M8.5 12.5h7M8.5 16h5"/>'),
    "folder": ("A folder", '<path d="M3 7.5A1.5 1.5 0 014.5 6H9l2 2.5h8.5A1.5 1.5 0 0121 10v8.5a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5z"/>'),
    "folder-open": ("Open a folder", '<path d="M3.5 18.5V7.5A1.5 1.5 0 015 6h4l2 2.5h6.5A1.5 1.5 0 0119 10v1"/><path d="M3.5 18.5l2.6-6.4A1.5 1.5 0 017.5 11h13a1 1 0 01.9 1.4l-2.7 6.7a1.5 1.5 0 01-1.4.9H5a1.5 1.5 0 01-1.5-1.5z"/>'),
    "package": ("Any other file", '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/><path d="M8 5.3l8 4.5"/>'),
    "archive": ("Zip, extract", '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M12 3v1.5M12 6.5V8M12 10v1.5"/><rect x="10.3" y="13.5" width="3.4" height="4" rx="1"/>'),
    "tag": ("Rename, label", '<path d="M3.5 12.4V4.5a1 1 0 011-1h7.9l8.1 8.1a1.5 1.5 0 010 2.1l-6.8 6.8a1.5 1.5 0 01-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>'),
    "copy": ("Copy", '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5A1.5 1.5 0 0014 3.5H5A1.5 1.5 0 003.5 5v9A1.5 1.5 0 005 15.5h3.5"/>'),
    "download": ("Download", '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 15.5v2.5a2 2 0 002 2h12a2 2 0 002-2v-2.5"/>'),
    "upload": ("Upload", '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15.5v2.5a2 2 0 002 2h12a2 2 0 002-2v-2.5"/>'),
    "save": ("Save, backup", '<path d="M5 3.5h11.5l4 4V19a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V5A1.5 1.5 0 015 3.5z"/><path d="M8 3.5V8h7.5V3.5"/><path d="M7 20.5V14h10v6.5"/>'),
    # People and access
    "user": ("A person", '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0115 0"/>'),
    "users": ("People, players", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M15.5 4.8a3.5 3.5 0 010 6.4M17.5 14a6.5 6.5 0 014 6"/>'),
    "mask": ("Acting as someone else", '<path d="M3.5 5h17v6.5a8.5 8.5 0 01-17 0z"/><path d="M7.5 10h2.5M14 10h2.5M9 15a4 4 0 006 0"/>'),
    "mail": ("Invite", '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>'),
    "link": ("A link", '<path d="M10 14a4.5 4.5 0 006.4.2l3-3a4.5 4.5 0 00-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 00-6.4-.2l-3 3a4.5 4.5 0 006.4 6.4l1.2-1.2"/>'),
    "sign-out": ("Sign out", '<path d="M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4"/><path d="M15 8l4 4-4 4M19 12H9"/>'),
    "key": ("Sign in, password", '<circle cx="7.5" cy="15.5" r="3.8"/><path d="M10.2 12.8l9.3-9.3M16 7l2.5 2.5M13.5 9.5l2 2"/>'),
    "lock": ("Locked, private, security", '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/><path d="M12 14.5v2.5"/>'),
    "unlock": ("Remove the lock", '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 017.7-1.5"/><path d="M12 14.5v2.5"/>'),
    "fingerprint": ("Fingerprint unlock", '<path d="M5.2 8.6A8 8 0 0119.4 9"/><path d="M4.6 13.2a8.2 8.2 0 01.4-2.3"/><path d="M8.3 19.6c-.9-1.9-1.4-4-1.4-6.3a5.1 5.1 0 0110.2 0v1"/><path d="M12 13.3c0 2.9.8 5.3 2 7.2"/><path d="M9.5 13.2a2.5 2.5 0 015 0c0 1.9.4 3.6 1.2 5.1"/><path d="M17.1 17.3c.3 1 .7 1.9 1.2 2.7"/>'),
    "shield": ("Security, admin", '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>'),
    # Server and power
    "play": ("Start, run, resume", '<path d="M8 5.5v13l10.5-6.5z"/>'),
    "pause": ("Pause", '<path d="M8.5 5.5v13M15.5 5.5v13"/>'),
    "stop": ("Stop", '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>'),
    "restart": ("Restart, sync", '<path d="M20 12a8 8 0 11-2.4-5.7"/><path d="M20 4.5v4h-4"/>'),
    "power": ("Power controls", '<path d="M12 3.5v8"/><path d="M6.7 6.6a7.5 7.5 0 1010.6 0"/>'),
    "update": ("Update", '<circle cx="12" cy="12" r="9"/><path d="M12 16.5v-9M8.5 11l3.5-3.5 3.5 3.5"/>'),
    "sun": ("Wake", '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    "moon": ("Sleep", '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>'),
    "gear": ("Settings, the system", '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>'),
    "globe": ("An address on the internet, public", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
    "plug": ("Publish, connect", '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 01-12 0z"/><path d="M12 17v4"/>'),
    "layers": ("Snapshots", '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12l8.5 4.5 8.5-4.5"/><path d="M3.5 16l8.5 4.5 8.5-4.5"/>'),
    "camera": ("Take a snapshot", '<path d="M4 7.5h3l1.5-2.5h7L17 7.5h3a1.5 1.5 0 011.5 1.5v9.5A1.5 1.5 0 0120 20H4a1.5 1.5 0 01-1.5-1.5V9A1.5 1.5 0 014 7.5z"/><circle cx="12" cy="13.5" r="3.5"/>'),
    "restore": ("Restore a snapshot", '<path d="M3.8 13a8.5 8.5 0 102.6-7"/><path d="M3.5 4v4.5H8"/><path d="M12 8v4.5l3 2"/>'),
    "undo": ("Bring back from deleted", '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
    "flame": ("Delete forever", '<path d="M12 21c-4 0-6.5-2.7-6.5-6.3 0-3.2 2.2-5.3 3.6-7.4.4 1.8 1.4 3 2.6 3.4-.4-3 1-5.8 3.3-7.7.3 3.4 4.5 5.8 4.5 11.4 0 3.8-3 6.6-7.5 6.6z"/>'),
    "pin": ("Pinned", '<path d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9z"/><path d="M12 12.5V21"/>'),
    "clock": ("Schedules, scheduled", '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M3.8 5.5l3-2.5M20.2 5.5l-3-2.5"/>'),
    "timer": ("A timer", '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5"/><path d="M9.5 2.5h5M12 2.5V6"/><path d="M18.3 7.2l1.5-1.5"/>'),
    "receipt": ("Run history", '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3.5"/>'),
    "chart": ("Charts, analytics", '<path d="M4 20h16"/><path d="M7 16.5v-5M12 16.5V6.5M17 16.5v-8"/>'),
    "ram": ("Memory in use", '<rect x="2.5" y="7" width="19" height="9" rx="1.5"/><path d="M6.5 10v3M10 10v3M14 10v3M17.5 10v3"/><path d="M5.5 16v3M9.5 16v3M14.5 16v3M18.5 16v3"/>'),
    "chip": ("Memory, processor", '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>'),
    "terminal": ("Console", '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17"/>'),
    "monitor": ("A server, a machine", '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>'),
    "database": ("Storage", '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>'),
    "router": ("A router", '<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 16.5h.01M10 16.5h.01" stroke-width="2.4"/><path d="M15.5 13V9"/><path d="M12.5 6.6a4.3 4.3 0 016 0M10.4 4.3a7.5 7.5 0 0110.2 0"/>'),
    "signal": ("Network signal", '<path d="M5 20v-3M10 20v-7M15 20v-11M20 20V5"/>'),
    "chat": ("Chat", '<path d="M4 5.5h16a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5H10.5L6 21v-3.5H4A1.5 1.5 0 012.5 16V7A1.5 1.5 0 014 5.5z"/>'),
    "code": ("Code", '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>'),
    "cloud": ("Cloud", '<path d="M7 18.5a4.5 4.5 0 01-.6-9 6 6 0 0111.4 1.6 3.8 3.8 0 01-.3 7.4z"/>'),
    "bolt": ("Speed, power", '<path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z"/>'),
    "sliders": ("Tuning", '<path d="M4 7h9.5M17.5 7H20M4 17h3.5M11.5 17H20"/><circle cx="15.5" cy="7" r="2"/><circle cx="9.5" cy="17" r="2"/>'),
    "wrench": ("Build", '<path d="M15 3.5a5 5 0 00-4.6 7L3.8 17.1a2.2 2.2 0 003.1 3.1l6.6-6.6A5 5 0 0020.5 9l-3 3-2.5-.5-.5-2.5 3-3A5 5 0 0015 3.5z"/>'),
    "hammer": ("Construction", '<path d="M14 3.5l6.5 6.5-2 2L12 5.5z"/><path d="M13 8.5l-8.5 8.5a2.1 2.1 0 003 3L16 11.5"/>'),
    "puzzle": ("Extensions, mods", '<path d="M10 4.5a2 2 0 014 0V6h4v4h-1.5a2 2 0 000 4H18v4h-4v-1.5a2 2 0 00-4 0V18H6v-4h1.5a2 2 0 000-4H6V6h4z"/>'),
    "map": ("Map, world", '<path d="M3.5 6.5L9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
    "mountain": ("Terrain", '<path d="M2.5 19.5l6.5-11 4 6.5 2.5-4 6 8.5z"/>'),
    "star": ("Featured", '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>'),
    "trophy": ("Events, rewards", '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 5.5H4.5v1A3.5 3.5 0 008 10M16 5.5h3.5v1A3.5 3.5 0 0116 10"/><path d="M12 13v3.5M8.5 20.5h7M10 16.5h4v4h-4z"/>'),
    "paw": ("Animals, pets", f'<circle cx="6" cy="11" r="1.9"/><circle cx="9.5" cy="6.3" r="1.9"/><circle cx="14.5" cy="6.3" r="1.9"/><circle cx="18" cy="11" r="1.9"/><path d="M12 12c-2.5 0-5 3.2-5 5.3 0 1.7 1.3 2.7 2.8 2.7 1 0 1.5-.6 2.2-.6s1.2.6 2.2.6c1.5 0 2.8-1 2.8-2.7 0-2.1-2.5-5.3-5-5.3z"/>'),
    "sprout": ("Farming", '<path d="M12 21V11"/><path d="M12 11C12 7.5 9.5 5 6 5c0 3.5 2.5 6 6 6zM12 14c0-3 2.2-5.5 5.5-5.5 0 3-2.2 5.5-5.5 5.5z"/>'),
    "rocket": ("Launch", '<path d="M12 15.5L8.5 12C10 7 13.5 3.5 20.5 3.5c0 7-3.5 10.5-8.5 12z"/><path d="M8.5 12H5L7.5 8.5H11M12 15.5V19l3.5-2.5V13"/><path d="M6.5 16.5c-1.5 1-2 3-2 3s2-.5 3-2"/>'),
    "palette": ("Appearance", '<path d="M12 3.5a8.5 8.5 0 000 17c1.4 0 2-1 1.6-2.1-.4-1.2.4-2.4 1.7-2.4H18a2.5 2.5 0 002.5-2.5c0-5.5-3.8-10-8.5-10z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10.5" cy="7.5" r="1.2"/><circle cx="15" cy="8" r="1.2"/>'),
    "speaker": ("Sound", '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 010 6M18.5 6.5a8 8 0 010 11"/>'),
    "eye": ("Visibility", '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    "gamepad": ("Games, instances", '<path d="M7 7h10a5 5 0 014.9 6l-.8 4a3 3 0 01-5.3 1.3L14 16h-4l-1.8 2.3a3 3 0 01-5.3-1.3l-.8-4A5 5 0 017 7z"/><path d="M8 10.5v3M6.5 12h3"/><path d="M15.5 11v.01M17.5 13v.01" stroke-width="2.4"/>'),
    "joystick": ("Play time", '<circle cx="12" cy="6.5" r="3"/><path d="M12 9.5v6"/><path d="M5 15.5h14l1 4.5H4z"/>'),
    "flask": ("Demo data", '<path d="M9.5 3h5M10.5 3v6L5 18.5A1.7 1.7 0 006.5 21h11a1.7 1.7 0 001.5-2.5L13.5 9V3"/><path d="M7.5 15h9"/>'),
}
os.makedirs(f"{ROOT}/assets/icons", exist_ok=True)
for name, (_, body) in ICONS.items():
    with open(f"{ROOT}/assets/icons/{name}.svg", "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" {S}>{body}</svg>\n')


def ident(name):
    parts = name.split("-")
    return parts[0] + "".join(p.title() for p in parts[1:]) + "Icon"


lines = ['import { Image, token } from "nsh";']
for name in ICONS:
    lines.append(f'import {ident(name)} from "../../assets/icons/{name}.svg";')
lines.append("")
lines.append("/**")
lines.append(" * The app's own icons, in place of emoji: 24-point white line art in assets/icons (made by")
lines.append(" * scripts/make-icons.py), tinted to the text they sit with. One style everywhere, the same on every phone.")
lines.append(" */")
lines.append("const ICONS = {")
for name, (meaning, _) in ICONS.items():
    lines.append(f'  "{name}": {ident(name)}, // {meaning}')
lines.append("} as const;")
lines.append("")
lines.append("export type IconName = keyof typeof ICONS;")
lines.append("")
lines.append("/** Theme colours an icon can take, as the text classes of the same names. */")
lines.append('export type IconTone = "foreground" | "muted" | "primary" | "destructive" | "success" | "warning" | "white" | "on-primary";')
lines.append("")
lines.append("const TONES: Record<Exclude<IconTone, \"white\">, Parameters<typeof token>[0]> = {")
lines.append('  foreground: "foreground",')
lines.append('  muted: "muted-foreground",')
lines.append('  primary: "primary",')
lines.append('  destructive: "destructive",')
lines.append('  success: "success",')
lines.append('  warning: "warning",')
lines.append('  "on-primary": "primary-foreground",')
lines.append("};")
lines.append("")
lines.append("export function iconColor(tone: IconTone = \"foreground\"): string {")
lines.append('  return tone === "white" ? "#ffffff" : String(token(TONES[tone]));')
lines.append("}")
lines.append("")
lines.append("/** An icon, `size` points square, tinted with a theme tone (or any `color`). */")
lines.append("export function Icon(props: { name: IconName; size?: number; tone?: IconTone; color?: string; label?: string; testID?: string }) {")
lines.append("  const size = () => props.size ?? 18;")
lines.append("  return (")
lines.append("    <Image")
lines.append("      src={ICONS[props.name]}")
lines.append("      testID={props.testID}")
lines.append("      accessibilityLabel={props.label}")
lines.append("      style={{ width: size(), height: size(), tintColor: props.color ?? iconColor(props.tone) }}")
lines.append("    />")
lines.append("  );")
lines.append("}")
lines.append("")
lines.append("/** Whether a string names an icon (for values that come from data, such as a settings group's icon). */")
lines.append("export function isIconName(name: string | null | undefined): name is IconName {")
lines.append("  return !!name && Object.prototype.hasOwnProperty.call(ICONS, name);")
lines.append("}")
with open(f"{ROOT}/src/components/Icon.tsx", "w") as f:
    f.write("\n".join(lines) + "\n")
print(len(ICONS), "icons")
