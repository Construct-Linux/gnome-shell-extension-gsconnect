// SPDX-FileCopyrightText: GSConnect Developers https://github.com/GSConnect
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';


const ICON_PATH = 'resource://org/gnome/Shell/Extensions/GSConnect/icons';

// Icons the menus and indicators ask for that GSConnect's GResource carries
const BUNDLED_ICONS = new Set([
    'org.gnome.Shell.Extensions.GSConnect',
    'org.gnome.Shell.Extensions.GSConnect-symbolic',
    'computer-symbolic',
    'laptop-symbolic',
    'smartphone-symbolic',
    'tablet-symbolic',
    'tv-symbolic',
    'phonelink-ring-symbolic',
    'sms-symbolic',
]);

/**
 * Get a St.Icon fallback for a themed icon from GSConnect's GResource, for
 * icon themes that do not carry it.
 *
 * @param {Gio.Icon} gicon - The icon an St.Icon is asked to show
 * @returns {Gio.Icon|null} The bundled icon, or %null if there is none
 */
export function getFallbackIcon(gicon) {
    if (!(gicon instanceof Gio.ThemedIcon))
        return null;

    const [name] = gicon.names;

    if (!BUNDLED_ICONS.has(name))
        return null;

    return new Gio.FileIcon({
        file: Gio.File.new_for_uri(`${ICON_PATH}/${name}.svg`),
    });
}
