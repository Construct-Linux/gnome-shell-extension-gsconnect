// SPDX-FileCopyrightText: GSConnect Developers https://github.com/GSConnect
//
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';


/*
 * DBus Interface Info
 */
const DBUS_NAME = 'org.gnome.Shell.Extensions.GSConnect.Clipboard';
const DBUS_PATH = '/org/gnome/Shell/Extensions/GSConnect/Clipboard';
const DBUS_NODE = Gio.DBusNodeInfo.new_for_xml(`
<node>
  <interface name="org.gnome.Shell.Extensions.GSConnect.Clipboard">
    <!-- Methods -->
    <method name="GetMimetypes">
      <arg direction="out" type="as" name="mimetypes"/>
    </method>
    <method name="GetText">
      <arg direction="out" type="s" name="text"/>
    </method>
    <method name="SetText">
      <arg direction="in" type="s" name="text"/>
    </method>
    <method name="GetValue">
      <arg direction="in" type="s" name="mimetype"/>
      <arg direction="out" type="ay" name="value"/>
    </method>
    <method name="SetValue">
      <arg direction="in" type="ay" name="value"/>
      <arg direction="in" type="s" name="mimetype"/>
    </method>

    <!-- Signals -->
    <signal name="OwnerChange"/>
  </interface>
</node>
`);
const DBUS_INFO = DBUS_NODE.lookup_interface(DBUS_NAME);


/*
 * Text Mimetypes
 */
const TEXT_MIMETYPES = [
    'text/plain;charset=utf-8',
    'UTF8_STRING',
    'text/plain',
    'STRING',
];


/* GSConnectClipboardPortal:
 *
 * A simple clipboard portal, especially useful on Wayland where GtkClipboard
 * doesn't work in the background. Only the GSConnect service may use it: any
 * other session bus client would otherwise read and replace the clipboard
 * without the user's knowledge.
 */
export class Clipboard {

    /**
     * @param {string} serviceOwner - Unique bus name of the GSConnect service
     */
    constructor(serviceOwner) {
        this._serviceOwner = serviceOwner;
        this._connection = null;
        this._transferring = false;

        // Watch global selection
        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect(
            'owner-changed',
            this._onOwnerChanged.bind(this)
        );

        // Prepare DBus interface
        const handler = {};
        for (const method of DBUS_INFO.methods) {
            handler[`${method.name}Async`] = (params, invocation) => {
                this._dispatch(method, params, invocation);
            };
        }
        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_INFO, handler);

        this._nameId = Gio.DBus.own_name(
            Gio.BusType.SESSION,
            DBUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            this._onBusAcquired.bind(this),
            null,
            this._onNameLost.bind(this)
        );
    }

    async _dispatch(method, params, invocation) {
        if (invocation.get_sender() !== this._serviceOwner) {
            invocation.return_dbus_error(
                'org.freedesktop.DBus.Error.AccessDenied',
                `${method.name} is only available to the GSConnect service`
            );
            return;
        }

        try {
            const result = await this[method.name](...params);

            if (method.out_args.length === 0) {
                invocation.return_value(null);
            } else {
                const signature = method.out_args.map(arg => arg.signature);
                invocation.return_value(
                    new GLib.Variant(`(${signature.join('')})`, [result])
                );
            }
        } catch (e) {
            if (e instanceof GLib.Error) {
                invocation.return_gerror(e);
            } else {
                invocation.return_error_literal(Gio.DBusError,
                    Gio.DBusError.FAILED, e.message);
            }
        }
    }

    _onOwnerChanged(selection, type, source) {
        /* We're only interested in the standard clipboard */
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD)
            return;

        /* In Wayland an intermediate GMemoryOutputStream is used which triggers
         * a second ::owner-changed emission, so we need to ensure we ignore
         * that while the transfer is resolving.
         */
        if (this._transferring)
            return;

        this._transferring = true;

        /* We need to put our signal emission in an idle callback to ensure that
         * Mutter's internal calls have finished resolving in the loop, or else
         * we'll end up with the previous selection's content.
         */
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._transferring = false;

            // Addressed to the service alone, like the methods
            this._connection?.emit_signal(this._serviceOwner, DBUS_PATH,
                DBUS_NAME, 'OwnerChange', null);

            return GLib.SOURCE_REMOVE;
        });
    }

    _onBusAcquired(connection, name) {
        try {
            this._connection = connection;
            this._dbus.export(connection, DBUS_PATH);
        } catch (e) {
            logError(e);
        }
    }

    _onNameLost(connection, name) {
        try {
            this._dbus.unexport();
        } catch (e) {
            logError(e);
        }
    }

    /**
     * Get the available mimetypes of the current clipboard content
     *
     * @returns {Promise<string[]>} A list of mime-types
     */
    GetMimetypes() {
        return new Promise((resolve, reject) => {
            try {
                const mimetypes = this._selection.get_mimetypes(
                    Meta.SelectionType.SELECTION_CLIPBOARD
                );

                resolve(mimetypes);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Get the text content of the clipboard
     *
     * @returns {Promise<string>} Text content of the clipboard
     */
    GetText() {
        return new Promise((resolve, reject) => {
            const mimetypes = this._selection.get_mimetypes(
                Meta.SelectionType.SELECTION_CLIPBOARD);

            const mimetype = TEXT_MIMETYPES.find(type => mimetypes.includes(type));

            if (mimetype !== undefined) {
                const stream = Gio.MemoryOutputStream.new_resizable();

                this._selection.transfer_async(
                    Meta.SelectionType.SELECTION_CLIPBOARD,
                    mimetype, -1,
                    stream, null,
                    (selection, res) => {
                        try {
                            selection.transfer_finish(res);

                            const bytes = stream.steal_as_bytes();
                            const bytearray = bytes.get_data();

                            resolve(new TextDecoder().decode(bytearray));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            } else {
                reject(new Error('text not available'));
            }
        });
    }

    /**
     * Set the text content of the clipboard
     *
     * @param {string} text - text content to set
     * @returns {Promise} A promise for the operation
     */
    SetText(text) {
        return new Promise((resolve, reject) => {
            try {
                const source = Meta.SelectionSourceMemory.new(
                    'text/plain;charset=utf-8', GLib.Bytes.new(text));

                this._selection.set_owner(
                    Meta.SelectionType.SELECTION_CLIPBOARD, source);

                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Get the content of the clipboard with the type {@link mimetype}.
     *
     * @param {string} mimetype - the mimetype to request
     * @returns {Promise<Uint8Array>} The content of the clipboard
     */
    GetValue(mimetype) {
        return new Promise((resolve, reject) => {
            const stream = Gio.MemoryOutputStream.new_resizable();

            this._selection.transfer_async(
                Meta.SelectionType.SELECTION_CLIPBOARD,
                mimetype, -1,
                stream, null,
                (selection, res) => {
                    try {
                        selection.transfer_finish(res);

                        const bytes = stream.steal_as_bytes();

                        resolve(bytes.get_data());
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * Set the content of the clipboard to {@link value} with the type
     * {@link mimetype}.
     *
     * @param {Uint8Array} value - the value to set
     * @param {string} mimetype - the mimetype of the value
     * @returns {Promise} - A promise for the operation
     */
    SetValue(value, mimetype) {
        return new Promise((resolve, reject) => {
            try {
                const source = Meta.SelectionSourceMemory.new(mimetype,
                    GLib.Bytes.new(value));

                this._selection.set_owner(
                    Meta.SelectionType.SELECTION_CLIPBOARD, source);

                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    destroy() {
        if (this._selection && this._ownerChangedId > 0) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = 0;
        }

        if (this._nameId > 0) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }

        try {
            this._dbus.unexport();
        } catch (e) {
            logError(e);
        }

        this._connection = null;
    }
}


let _portal = null;
let _portalId = 0;

/**
 * Watch for the service to start and export the clipboard portal when it does.
 */
export function watchService() {
    if (_portalId > 0)
        return;

    _portalId = Gio.bus_watch_name(
        Gio.BusType.SESSION,
        'org.gnome.Shell.Extensions.GSConnect',
        Gio.BusNameWatcherFlags.NONE,
        (connection, name, nameOwner) => {
            _portal?.destroy();
            _portal = new Clipboard(nameOwner);
        },
        () => {
            if (_portal !== null) {
                _portal.destroy();
                _portal = null;
            }
        }
    );
}

